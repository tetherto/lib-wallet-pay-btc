'use strict'
const { EventEmitter } = require('events')
const Bitcoin = require('./currency')
const UnspentStore = require('./unspent-store.js')
const { AddressManager } = require('./address-manager.js')
const AddressWatch = require('./address-watch.js')
const TotalBalance = require('./total-balance.js')

/**
 * Class that manages syncing local state with electrum/blockchain.
 *
 * * Watch for address updates for electrum and update utxo and balances per address
 *
 * * Manage total balance calc
 *
**/
class SyncManager extends EventEmitter {
  constructor (config) {
    super()

    this.state = config.state
    this.gapLimit = config.gapLimit
    this.hdWallet = config.hdWallet
    this.utxoManager = config.utxoManager
    this.provider = config.provider
    this.keyManager = config.keyManager
    this.currentBlock = config.currentBlock
    this.minBlockConfirm = config.minBlockConfirm
    this.store = config.store
    this._addressType = config.addressType

    // @desc: halt syncing
    this._halt = false
    // @desc: syncing flag
    this._isSyncing = false

    this._tx_events = []

    // @desc: Manage watching address changes from electrum
    this._addrWatch = new AddressWatch({
      state: this.state,
      provider: this.provider
    })
    this._addrWatch.on('new-tx', async (changeHash) => {
      if (this._halt) return
      try {
        await this._updateScriptHashBalance(changeHash)
      } catch(err) {
        console.log('failed to update addr balance', err)
        return 
      }
      this.emit('new-tx')
    })

    this.reset()
  }

  async init () {
    this._addrWatch.startWatching()

    // @desc: Address manager manages sync states per address
    this._addr = new AddressManager({ store: this.store })
    await this._addr.init()
    // @desc: Unspent store manages state VIN/VOUT for spending btc
    this._unspent = new UnspentStore({ store: this.store })
    await this._unspent.init()
    // @desc: manage total balance of wallet
    this._totalBal = new TotalBalance({
      state: this.state
    })
    await this._totalBal.init()
  }

  async reset () {
    if (this._totalBal) {
      await this._totalBal.resetBalance()
    }
    await this.resumeSync()
    await this.hdWallet.resetSyncState()
  }

  async close () {
    this.stopSync()
    this._addr && await this._addr.close()
    this._unspent && await this._unspent.close()
  }

  addSentTx (tx) {
    return this._addr.addSentTx(tx)
  }

  getSentTx (txid) {
    return this._addr.getSentTx(txid)
  }

  async _updateScriptHashBalance (changeHash) {
    const { provider, _addrWatch } = this
    const { extlist, inlist } = await _addrWatch.getWatchedAddress()

    const process = async (data) => {
      await Promise.all(data.map(async ([scripthash, balHash]) => {
        if (changeHash === balHash) return
        if (this._halt) return
        const txHistory = await provider.getAddressHistory({ cache: false }, scripthash)
        await this._processHistory(txHistory)
      }))
    }
    await process(extlist)
    await process(inlist)

    await _addrWatch.stopWatching(inlist)

    // update unspent store
    await this._unspent.process()
  }

  /**
  * @description watch address for changes and save to store for when lib is resumed
  **/
  async watchAddress ([scriptHash, addr], addrType) {
    // @desc: create address balance object
    await this._addr.newAddress(addr.address)
    // @desc: start watching address balance changes
    await this._addrWatch.watchAddress(scriptHash, addrType)
  }

  /**
   * @description utxo that is locked for spending
  */
  async unlockUtxo (state) {
    return this._unspent.unlock(state)
  }

  async updateBlock (block) {
    if (block.current !== 0 && block.diff > 0 && block.last !== 0) {
      this.currentBlock = block
      this._newBlock()
      return
    }
    this.currentBlock = block
  }

  /**
   * @desc emit event for a txid when found in mempool
   *
  **/
  watchTxMempool (txid) {
    if (this._tx_events.includes(txid)) return
    this._tx_events.push(txid)
  }

  /**
   * @desc fire event for tx being watched
   **/
  _emitTxEvent (tx) {
    const index = this._tx_events.indexOf(tx.txid)
    if ((tx.height === 0) && index >= 0) {
      this._tx_events.splice(index, 1)
      this.emit('tx:mempool:' + tx.txid, tx)
    }
  }

  /**
  * @description process new block, catch up with missed blocks, and update balances and utxo store
  **/
  async _newBlock () {
    const { currentBlock } = this

    // Get all txs in block range.
    // We don't get tx in mempool as those are handled in _handleScriptHashChange
    let arr = []
    for (let i = currentBlock.last; i <= currentBlock.current; i++) {
      const z = await this._addr.getTxHeight(i)
      if (!z) continue
      arr = arr.concat(z)
    }

    if (arr.length === 0) return

    let newTx
    try {
      newTx = await Promise.all(arr.map(async (tx) => {
        return await this.provider.getTransaction(tx.txid, { cache: false })
      }))
    } catch(err) {
      console.log('failed to get tx ', err)
      return 
    }

    await this._processHistory(newTx)
    await this._unspent.process()

    if (arr.length > 0) {
      this.emit('new-tx')
    }
  }

  /**
  * @desc Store transaction history and process VIN and VOUTS.
  * This functions is called when there is a new block, syncing entire wallet, new script hash change is detected
  * @param {Array} txHistory transaction history
  * @param {String} path hd path string
  * @return {Promise}
  * */
  async _processHistory (txHistory, path) {
    const { _addr } = this

    txHistory = await Promise.all(txHistory.map(async (tx) => {
      const txState = this._getTxState(tx)
      await this._processUtxo(tx.out, 'out', txState, tx.fee, path)
      await this._processUtxo(tx.in, 'in', txState, 0, path)
      if (tx.height === 0 && !tx.mempool_first_seen) {
        tx.mempool_ts = Date.now()
      }
      return tx
    }))
    await _addr.storeTxHistory(txHistory)

    txHistory.forEach((tx) => {
      this._emitTxEvent(tx)
    })
  }

  /**
  * @description process a path for transactions/history and count gap limit.
  */
  async _processPath (path, signal) {
    const { keyManager, provider, _halt } = this

    const { hash: scriptHash } = keyManager.pathToScriptHash(path, this._addressType)
    let txHistory
    try {
      txHistory = await provider.getAddressHistory({}, scriptHash)
    } catch (e) {
      return signal.stop
    }
    if (_halt) return signal.stop

    if (Array.isArray(txHistory) && txHistory.length === 0) {
      // increase gap count if address has no tx
      return signal.noTx
    }
    await this._processHistory(txHistory, path)
    return signal.hasTx
  }

  /**
   * @description Sync internal wallet state per HD wallet path
   * @return {Promise}
   **/
  async syncAccount (opts) {
    if (this._halt || this._isSyncing) throw new Error('halted:' + this._halt + ' is syncing: ' + this._isSyncing)
    const { hdWallet } = this
    this._isSyncing = true

    if (opts?.restart) {
      await hdWallet.resetSyncState()
      await this._addr.clear()
    }

    await hdWallet.eachAccount(async (syncState, signal) => {
      if (this._halt) return signal.stop
      const path = syncState.path
      const res = await this._processPath(path, signal)
      this.emit('synced-path', syncState._addrType, path, res === signal.hasTx, syncState.toJSON())
      return res
    })

    if (this._halt) {
      this._isSyncing = false
      this.emit('sync-end')
      this.resumeSync()
      return
    }
    await this._unspent.process()
    this._isSyncing = false
    this.resumeSync()
    this.emit('sync-end')
  }

  /**
  * @description get balance for an address
  * @param {String} addr optional address if you want to pass in address to get its balance
  * @return {Promise}
  **/
  async getBalance (addr) {
    if (!addr) {
      return this._totalBal.getSpendableBalance()
    }
    const total = await this._addr.get(addr)
    if (!total) throw new Error('Address not valid or not processed for balance ' + addr)
    return total.out.combine(total.in)
  }

  /**
   * Determines the state of a transaction based on its height and the current block.
   *
   * @private
   * @param {Object} tx - The transaction object.
   * @param {number} tx.height - The block height of the transaction. A height of 0 indicates it's in the mempool.
   * @returns {string} The state of the transaction: 'mempool', 'confirmed', or 'pending'.
   *
   * @description
   * This method categorizes a transaction into one of three states:
   * - 'mempool': The transaction is not yet included in a block (height is 0).
   * - 'confirmed': The transaction is included in a block and has the required number of confirmations.
   * - 'pending': The transaction is included in a block but doesn't yet have the required number of confirmations.
   *
   * The number of required confirmations is determined by the `minBlockConfirm` property of the class.
   */
  _getTxState (tx) {
    if (tx.height === 0) return 'mempool'
    const diff = this.currentBlock.current - tx.height
    if (diff >= this.minBlockConfirm) return 'confirmed'
    return 'pending'
  }

  /**
   * @desc Processes a list of UTXOs, updating balances and the UTXO store. For each UTXO:
   * 1. Retrieves or creates balance for the UTXO's address
   * 2. Gets or derives address info from HD wallet
   * 3. Generates a unique identifier for the UTXO, called POINT
   * 4. Updates UTXO with address public key and path, we need this to spend later
   * 5. Updates address balance and total balance of the wallet
   * 6. Adds transaction fee to balance if applicable.
   * 7. Saves updated balance
   * 8. Adds UTXO to unspent store for future transaction signings
   * Skips processing if UTXO has already been processed for the given state
   * @private
   * @param {Array<Object>} utxoList - UTXOs to process
   * @param {'in'|'out'} inout - Transaction direction
   * @param {'mempool'|'confirmed'|'pending'} txState - Transaction state
   * @param {number} [txFee=0] - Transaction fee
   * @param {string} [path] - HD wallet path
   * @returns {Promise<void[]>} Promise resolving when all UTXOs are processed
   */
  async _processUtxo (utxoList, inout, txState, txFee = 0, path) {
    const { _addr, keyManager, hdWallet, _totalBal, _unspent } = this
    return Promise.all(utxoList.map(async (utxo) => {
      /** @type {Object} UTXO address balance */
      let bal = await _addr.get(utxo.address)
      /** @type {Object} HD wallet address info */
      let addr = await hdWallet.getAddress(utxo.address)

      if (!bal) {
      /** @desc Create new address if balance doesn't exist */
        await _addr.newAddress(utxo.address)
        bal = await _addr.get(utxo.address)
      }

      if (path && !addr) {
      /** @desc Derive address from path if not in HD wallet */
        const addrObj = keyManager.pathToScriptHash(path, 'p2wpkh')
        if (addrObj.addr.address !== utxo.address) return
        await hdWallet.addAddress(addrObj.addr)
        addr = await hdWallet.getAddress(addrObj.addr.address)
      } else if (!addr) {
        return
      }

      /** @type {string} Unique UTXO identifier */
      const point = inout === 'out' ? utxo.txid + ':' + utxo.index : utxo.prev_txid + ':' + utxo.prev_index

      /** @desc Skip if already processed */
      if (bal[inout].getTx(txState, point)) return

      /** @desc Set UTXO address info */
      utxo.address_public_key = addr.publicKey
      utxo.address_path = addr.path

      /** @desc Update balances */
      bal[inout].addTxid(txState, point, utxo.value)
      _totalBal.addTxId(inout, txState, utxo, point, txFee)

      if (txFee > 0) {
        bal.fee.addTxid(txState, point, txFee)
      }

      /** @desc Save updated balance */
      _addr.set(utxo.address, bal)

      /** @desc Add to unspent store for future signings */
      await _unspent.add(utxo, inout)
    }))
  }

  stopSync () {
    this._halt = true
  }

  resumeSync () {
    this._halt = false
  }

  isStopped () { return this._halt }

  async utxoForAmount (value, strategy) {
    if (!(value instanceof Bitcoin)) {
      value = new Bitcoin(value.amount, value.unit)
    }
    return this._unspent.getUtxoForAmount(value, strategy)
  }

  getTransactions (fn) {
    return this._addr.getTransactions(fn)
  }
}

module.exports = SyncManager
