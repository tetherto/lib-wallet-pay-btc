'use strict'
const { EventEmitter } = require('events')
const HdWallet = require('./hdwallet.js')
const Bitcoin = require('./currency')
const UnspentStore = require('./unspent-store.js')
const { AddressManager, Balance } = require('./address-manager.js')

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
    this.maxScriptWatch = config.maxScriptWatch || 10

    // @desc: halt syncing
    this._halt = false
    // @desc: syncing flag
    this._isSyncing = false

    // @desc: max number of script hashes to watch
    this._max_script_watch = config.max_script_watch || 10

    this._tx_events = []
    this.reset()
  }

  async init () {
    await this._subscribeToScriptHashes()
    this._total = await this._getTotalBal()
    this._addr = new AddressManager({ store: this.store })
    await this._addr.init()
    this._unspent = new UnspentStore({ store: this.store })
    await this._unspent.init()

  }

  async reset () {
    const total = {
      in: new Balance(0, 0, 0),
      out: new Balance(0, 0, 0),
      fee: new Balance(0, 0, 0)
    }
    await this.state.setTotalBalance(total)
    this._total = total
    await this.resumeSync()
    await this.state.resetSyncState()
  }

  async close () {
    this._addr && await this._addr.close()
    this._unspent && await this._unspent.close()
  }

  addSentTx (tx) {
    return this._addr.addSentTx(tx)
  }

  getSentTx (txid) {
    return this._addr.getSentTx(txid)
  }

  async _getTotalBal() {
    const total = await this.state.getTotalBalance()
    if (!total) {
      return this._total
    }
    return {
      in: new Balance(total.in.confirmed, total.in.pending, total.in.mempool),
      out: new Balance(total.out.confirmed, total.out.pending, total.out.mempool),
      fee: new Balance(total.fee.confirmed, total.fee.pending, total.fee.mempool)
    }
  }

  async _subscribeToScriptHashes () {
    const { state, provider } = this
    const scriptHashes = (await state.getWatchedScriptHashes('in')).concat(
      await state.getWatchedScriptHashes('ext')
    )
    provider.on('new-tx', async (changeHash) => {
      if(this._halt) return
      await this._updateScriptHashBalance(changeHash)
      this.emit('new-tx')
    })
    await Promise.all(scriptHashes.map(async ([scripthash]) => {
      return provider.subscribeToAddress(scripthash)
    }))
  }

  async _updateScriptHashBalance (changeHash) {
    const { provider, state } = this
    const inlist = await state.getWatchedScriptHashes('in')
    const extlist = await state.getWatchedScriptHashes('ext')

    const process = async (data) => {
      await Promise.all(data.map(async ([scripthash, balHash]) => {
        if (changeHash === balHash) return
        if(this._halt) return
        const txHistory = await provider.getAddressHistory({ cache: false }, scripthash)
        await this._processHistory(txHistory)
      }))
    }

    await process(extlist)
    await process(inlist)

    await Promise.all(inlist.map((scripthash) => {
      return provider.unsubscribeFromAddress(scripthash)
    }))
    await this._unspent.process()
  }

  /**
  * @description watch address for changes and save to store for when lib is resumed 
  **/
  async watchAddress ([scriptHash, addr], addrType) {
    const { state, _max_script_watch: maxScriptWatch, provider, _addr } = this
    await _addr.newAddress(addr.address)
    const hashList = await state.getWatchedScriptHashes(addrType)
    if (hashList.length >= maxScriptWatch) {
      hashList.shift()
    }
    const balHash = await provider.subscribeToAddress(scriptHash)
    if (balHash?.message) {
      throw new Error('Failed to subscribe to address ' + balHash.message)
    }
    hashList.push([scriptHash, balHash])
    await state.addWatchedScriptHashes(hashList, addrType)
  }

  async unlockUtxo (state) {
    return this._unspent.unlock(state)
  }

  async updateBlock (block) {
    if(block.current !== 0 && block.diff > 0 && block.last !== 0 ) {
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
  watchTxMempool(txid) {
    if(this._tx_events.includes(txid)) return 
    this._tx_events.push(txid)
  }

  /** 
   * @desc fire event for tx being watched 
   **/
  _emitTxEvent(tx) {
    const index = this._tx_events.indexOf(tx.txid);
    if((tx.height  === 0) && index >= 0){
      this._tx_events.splice(index,1)
      this.emit('tx:mempool:'+tx.txid, tx)
    }
  }

  /**
  * @description process new block, catch up with missed blocks, and update balances and utxo store
  **/
  async _newBlock () {
    const { _addr, currentBlock } = this

    // Get all txs in block range.
    // We don't get tx in mempool as those are handled in _handleScriptHashChange
    let arr = []
    for(let i = currentBlock.last; i <= currentBlock.current; i++) {
      let z = await this._addr.getTxHeight(i)
      if(!z) continue
      arr = arr.concat(z)
    }
    
    if(arr.length === 0) return

    const newTx = await Promise.all(arr.map(async (tx) => {
      return await this.provider.getTransaction(tx.txid, { cache: false })
    }))

    const processTx = async (inout, tx) => {
      await Promise.all(tx[inout].map(async (utxo) => {
        // We get the address object from hdWallet, as it will be needed for signing tx
        return this._processHistory([tx])
      }))
    }

    await Promise.all(newTx.map(async (tx) => {
      await processTx('in', tx)
      await processTx('out', tx)
    }))
    
    await this._unspent.process()

    if(arr.length > 0) {
      this.emit('new-tx')
    }
  }

  /**
  * @desc Store transaction history and process VIN and VOUTS. 
  * This functions is called when there is a new block, syncing entire wallet, new script hash change is detected
  * @param {Object} addr address object
  * @param {Array} txHistory transaction history
  * @return {Promise}
  * */
  async _processHistory (txHistory) {
    const { _addr } = this


    txHistory = await Promise.all(txHistory.map(async (tx) => {
      const txState = this._getTxState(tx)
      await this._processUtxo(tx.out, 'out', txState, tx.fee, tx.txid)
      await this._processUtxo(tx.in, 'in', txState, 0, tx.txid)

      if(tx.height === 0 && !tx.mempool_first_seen) {
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
  async _processPath (path, gapEnd, gapCount) {
    const { keyManager, provider, gapLimit, _halt } = this

    if (_halt === true || gapCount >= gapLimit) {
      return [false, null, null, null]
    }
    let hasTx = false
    const [scriptHash, addr] = keyManager.pathToScriptHash(path, HdWallet.getAddressType(path))
    let txHistory 
    try {
      txHistory = await provider.getAddressHistory({}, scriptHash)
    } catch(e) {
      return [false, null, null, null]
    }

    if (Array.isArray(txHistory) && txHistory.length === 0) {
      // increase gap count if address has no tx
      gapCount++
    } else {
      await this._processHistory(txHistory)
      gapEnd++
      gapCount = 0
      hasTx = true
    }

    return [true, hasTx, gapEnd, gapCount]
  }

  async syncAccount (pathType, opts) {
    if (this._halt || this._isSyncing) throw new Error('already syncing '+this._halt+' '+this._isSyncing)
    const { gapLimit, hdWallet, state } = this
    this._isSyncing = true

    const syncState = await state.getSyncState(opts)
    const syncType = syncState[pathType]
    let gapEnd = gapLimit
    let gapCount = syncType.gap
    if (syncType.gap >= gapLimit) {
      this._isSyncing = false
      return
    }
    await hdWallet.eachAccount(pathType, syncType.path, async (path, halt) => {
      const res = await this._processPath(path, gapEnd, gapCount)
      const [done, hasTx] = res
      gapEnd = res[2]
      gapCount = res[3]
      if (!done) return halt()
      // Update path tracking state to not reuse addresses when reloaded
      if (hasTx) {
        hdWallet.updateLastPath(HdWallet.bumpIndex(path))
      }
      const syncType = syncState[pathType]
      syncType.path = path
      syncType.gap = gapCount
      syncType.gapEnd = gapEnd
      syncState[pathType] = syncType
      await state.setSyncState(syncState)
      this.emit('synced-path', pathType, path, hasTx, [gapCount, gapLimit, gapEnd])
    })

    if (this._halt) {
      this._isSyncing = false
      this.emit('sync-end')
      return
    }
    await this._unspent.process()
    this._isSyncing = false
    this.emit('sync-end')
  }

  async getBalance (addr) {
    let total
    if (!addr) {
      total = this._total
    } else {
      total = await this._addr.get(addr)
      if (!total) throw new Error('Address not valid or not processed for balance ' + addr)
    }
    return total.out.combine(total.in)
  }

  _getTxState (tx) {
    if (tx.height === 0) return 'mempool'
    const diff = this.currentBlock.current - tx.height
    if (diff >= this.minBlockConfirm) return 'confirmed'
    return 'pending'
  }

  /**
  * @description process tx history and update balances and utxo store
  * @param {Array} utxoList list of utxos
  * @param {String} inout in or out
  * @param {String} txState mempool, confirmed, pending
  * @param {Number} txFee fee for tx
  * @param {Object} addr address object
  * @param {String} txid transaction id
  * @return {Promise}
  * */
  async _processUtxo (utxoList, inout, txState, txFee = 0, txid) {
    const { _addr, _total, hdWallet } = this

    return Promise.all(utxoList.map(async (utxo) => {

      const bal = await _addr.get(utxo.address)
      const addr = await hdWallet.getAddress(utxo.address)
      if(!bal || !addr) return 
      // point is the txid:vout index. Unique id for utxo
      const point = inout === 'out' ? utxo.txid + ':' + utxo.index : utxo.prev_txid + ':' + utxo.prev_index
      // set public keys for utxo, as they will be needed for signing tx
      utxo.address_public_key = addr.publicKey
      utxo.address_path = addr.path
      
      // update balance of each tx state. mempool, confirmed, pending
      // add txid to txid list for each state
      _total[inout].addTxid(txState, point, utxo.value)
      bal[inout].addTxid(txState, point, utxo.value)

      // update fee balances
      if(txFee > 0) {
        _total.fee.addTxid(txState, point, txFee)
        bal.fee.addTxid(txState, point, txFee)
      }
      _addr.set(utxo.address, bal)
      // Add UTXO to unspent store for tx signings 
      await this._unspent.add(utxo, inout)
      await this.state.setTotalBalance(_total)
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
    if(!(value instanceof Bitcoin)) {
      value = new Bitcoin(value.amount, value.unit)
    }
    return this._unspent.getUtxoForAmount(value, strategy)
  }

  getTransactions (fn) {
    return this._addr.getTransactions(fn)
  }
}

module.exports = SyncManager
