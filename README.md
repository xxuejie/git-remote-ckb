git-remote-ckb
==============

Demo:

[![asciicast](https://asciinema.org/a/354704.svg)](https://asciinema.org/a/354704)

This is a [git remote helper](https://git-scm.com/docs/gitremote-helpers) using [Nervos CKB](https://www.nervos.org/) as the backend. It requires the following dependency:

* [ckb](https://github.com/nervosnetwork/ckb)
* [ckb-indexer](https://github.com/nervosnetwork/ckb-indexer)
* A CLI signing utility, an example could be found at [sign.c](./sign.c)

# Design

This is attempt at one possible direction of building dapps with CKB:

* A single cell in CKB represents a repository(to be more precise, a cell represents a unique branch, it's possible to build a repository that contains multiple cells with multiple branch.).
* Only the git tip hash is kept in the cell, which means no matter how large the repository grows, the storage requirement on CKB stays constant.
* Diff information is kept in transaction witness part. The full history is thus kept in a chain of transaction used to update the cell representing the repository.

Personally, I feel like this might be the correct way to use CKB: CKB, or common knowledge base, gets its name for a special purpose: only data that require global consensus, or common knowledge, should live on chain. The actual data could perfectly be stored elsewhere for maximum efficiency.
