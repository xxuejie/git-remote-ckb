const { Reader, RPC, normalizers } = require("ckb-js-toolkit");
const { core, utils } = require("@ckb-lumos/base");
const { CKBHasher } = utils;
const { common } = require("@ckb-lumos/common-scripts");
const { initializeConfig } = require("@ckb-lumos/config-manager");
const {
  parseAddress,
  sealTransaction,
  TransactionSkeleton,
} = require("@ckb-lumos/helpers");
const { execSync } = require("child_process");
const { readFileSync } = require("fs");
const tempy = require("tempy");

const { CkbIndexerQuerier } = require("./querier");

initializeConfig();

// TODO: RPC customization later
const CKB_RPC_URL = "http://127.0.0.1:8114";
const CKB_INDEXER_URL = "http://127.0.0.1:8116";

// TODO: fee customization, for now we hardcode to 0.01 CKB.
const FEE = BigInt(1000000);

const TYPE_ID_CODE_HASH = "0x00000000000000000000000000000000000000000000000000545950455f4944";
const INITIAL_TIP_HASH = "0x0000000000000000000000000000000000000000";

async function signAndSendTransactionSkeleton(skeleton, address) {
  const signatures = skeleton
    .get("signingEntries")
    .map(({ message }) => {
      const file = tempy.file();
      // TODO: customized signing command support.
      execSync(`ckb-cli util sign-message --from-account ${address} --message ${message} --output-format json --recoverable --no-color | tee ${file}`, { stdio: "inherit" });
      const content = readFileSync(file, { encoding: "utf8" }).substr(10);
      return JSON.parse(content).signature;
    })
    .toArray();
  const tx = sealTransaction(skeleton, signatures);
  const rpc = new RPC(CKB_RPC_URL);
  const hash = await rpc.send_transaction(tx);
  return hash;
}

async function createRepository(address) {
  let skeleton = TransactionSkeleton({ cellProvider: new CkbIndexerQuerier(CKB_INDEXER_URL) });
  skeleton = skeleton.update("outputs", (outputs) => {
    return outputs.push({
      cell_output: {
        capacity: "0x" + (BigInt(146) * BigInt(100000000)).toString(16),
        lock: parseAddress(address),
        type: {
          code_hash: TYPE_ID_CODE_HASH,
          hash_type: "type",
          args: "0x0000000000000000000000000000000000000000000000000000000000000000"
        }
      },
      data: INITIAL_TIP_HASH,
      out_point: undefined,
      block_hash: undefined,
    });
  });
  skeleton = skeleton.update("fixedEntries", (fixedEntries) => {
    return fixedEntries.push(
      {
        field: "outputs",
        index: 0,
      }
    );
  });
  skeleton = await common.injectCapacity(skeleton, [address], BigInt(146) * BigInt(100000000), address);
  const hasher = new CKBHasher();
  let inputCell = skeleton.get("inputs").get(0);
  hasher.update(
    core.SerializeCellInput(
      normalizers.NormalizeCellInput({
        previous_output: inputCell.out_point,
        since: "0x0",
      })
    )
  );
  hasher.update("0x0000000000000000");
  const typeId = hasher.digestHex();
  skeleton = skeleton.update("outputs", (outputs) => {
    return outputs.update(0, (output) => {
      output.cell_output.type.args = typeId;
      return output;
    });
  });
  skeleton = skeleton.update("fixedEntries", (fixedEntries) => {
    return fixedEntries.push(
      {
        field: "inputs",
        index: 0,
      }
    );
  });
  skeleton = await common.payFee(skeleton, [address], FEE);
  skeleton = common.prepareSigningEntries(skeleton);
  const hash = await signAndSendTransactionSkeleton(skeleton, address);
  const remoteUrl = `ckb://${address}@${typeId}`;
  return {
    hash,
    remoteUrl,
  };
}

async function locateRepositoryCell(remoteUrl) {
  const u = new URL(remoteUrl);
  const address = u.username;
  const typeId = u.host;

  const cellQuerier = new CkbIndexerQuerier(CKB_INDEXER_URL);
  const collector = cellQuerier.collector({
    type: {
      code_hash: TYPE_ID_CODE_HASH,
      hash_type: "type",
      args: typeId,
    },
  }).collect();
  const result = await collector.next();
  if (result.done) {
    throw new Error(`Cannot find repository at ${remoteUrl}`);
  }
  const cell = result.value;
  const result2 = await collector.next();
  if (!result2.done) {
    throw new Error("More than one repository cell exists, something is severely wrong!");
  }

  return {
    address, cell, typeId,
  };
}

async function sendToCkb(data, newTipHash, remoteUrl) {
  const { address, cell, typeId } = await locateRepositoryCell(remoteUrl);
  let skeleton = TransactionSkeleton({ cellProvider: new CkbIndexerQuerier(CKB_INDEXER_URL) });
  skeleton = skeleton.update("inputs", (inputs) => {
    return inputs.push(cell);
  }).update("outputs", (outputs) => {
    return outputs.push({
      cell_output: cell.cell_output,
      data: newTipHash,
      out_point: undefined,
      block_hash: undefined,
    });
  });
  const result = await common.setupInputCell(skeleton, cell, address);
  skeleton = result.txSkeleton;
  const oldWitnessArgs = new core.WitnessArgs(new Reader(skeleton.get("witnesses").get(0)));
  const witnessArgs = {
    lock: new Reader(oldWitnessArgs.getLock().value().raw()),
    input_type: new Reader(data),
  };
  const witness = core.SerializeWitnessArgs(normalizers.NormalizeWitnessArgs(witnessArgs));
  skeleton = skeleton.set("witnesses", (witnesses) => witnesses.set(0, witness));
  skeleton = skeleton.update("fixedEntries", (fixedEntries) => {
    return fixedEntries.push(
      {
        field: "inputs",
        index: 0,
      },
      {
        field: "outputs",
        index: 0,
      }
    );
  });
  skeleton = await common.payFee(skeleton, [address], FEE);
  skeleton = common.prepareSigningEntries(skeleton);
  return await signAndSendTransactionSkeleton(skeleton, address);
}

async function queryTipHash(remoteUrl) {
  try {
    const { cell } = await locateRepositoryCell(remoteUrl);
    if (cell.data !== INITIAL_TIP_HASH) {
      return cell.data;
    }
  } catch (e) {}
  return null;
}

async function downloadFromCkb(remoteUrl, currentTipHash = null) {
  const { cell } = await locateRepositoryCell(remoteUrl);
  const rpc = new RPC(CKB_RPC_URL);
  const bundles = [];
  let txHash = cell.out_point.tx_hash;
  while (true) {
    const tx = await rpc.get_transaction(cell.out_point.tx_hash);
    if (!tx) {
      throw new Error(`Unknown transaction ${cell.out_point.tx_hash}!`);
    }
    const txTipHash = tx.transaction.outputs_data[0];
    if (txTipHash === INITIAL_TIP_HASH ||
        (currentTipHash && (currentTipHash === txTipHash))) {
      break;
    }
    const witnessArgs = new core.WitnessArgs(new Reader(tx.transaction.witnesses[0]));
    const bundle = new Reader(witnessArgs.getInputType().value().raw()).serializeJson();
    bundles.unshift(bundle);
    txHash = tx.transaction.inputs.previous_output.tx_hash;
  }
  return bundles;
}

module.exports = {
  createRepository,
  sendToCkb,
  queryTipHash,
  downloadFromCkb,
};
