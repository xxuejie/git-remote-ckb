const { validators, RPC } = require("ckb-js-toolkit");

class CkbIndexerQuerier {
  constructor(uri) {
    this.uri = uri;
  }

  collector(queryOptions) {
    return new CkbIndexerCollector(this.uri, queryOptions);
  }
}

class CkbIndexerCollector {
  constructor(uri, {
    lock = null,
    type = null,
    argsLen = -1,
    data = "any",
    fromBlock = null,
    toBlock = null,
    skip = null,
  }) {
    if (lock && type) {
      throw new Error("Either lock or type is supported, you cannot specify both!");
    }
    if (type === "empty") {
      throw new Error("Empty type is not supported!");
    }
    if ((lock && lock.script) ||
        (type && type.script)) {
      throw new Error("ScriptWrapper is not supported!")
    }
    if (fromBlock || toBlock || skip) {
      throw new Error("fromBlock, toBlock and skip are not supported here!");
    }
    this.rpc = new RPC(uri);
    const searchKey = {};
    if (lock) {
      validators.ValidateScript(lock);
      searchKey.script = lock;
      searchKey.script_type = "lock";
    }
    if (type) {
      validators.ValidateScript(type);
      searchKey.script = type;
      searchKey.script_type = "type";
    }
    if (argsLen >= 0) {
      searchKey.args_len = "0x" + BigInt(argsLen).toString(16);
    }
    this.searchKey = searchKey;
    this.data = data;
  }

  async *collect() {
    let cursor = null;
    while (true) {
      const { objects, last_cursor } = await this.rpc.get_cells(this.searchKey, "asc", "0x200", cursor);
      if (objects.length === 0) {
        break;
      }
      for (const object of objects) {
        yield {
          cell_output: object.output,
          data: object.output_data,
          out_point: object.out_point,
          block_hash: undefined,
          block_number: object.block_number,
        };
      }
      cursor = last_cursor;
    }
  }
}

module.exports = { CkbIndexerQuerier };
