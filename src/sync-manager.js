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

    // @desc: halt syncing
    this._halt = false
    // @desc: syncing flag
    this._isSyncing = false

    // @desc: max number of script hashes to watch
    this._max_script_watch = config.max_script_watch || 10
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
    this.resumeSync()
    this.state.resetSyncState()
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
    const scriptHashes = await state.getWatchedScriptHashes()
    provider.on('new-tx', async (changeHash) => {
      await this._updateScriptHashBalance(changeHash)
      this.emit('new-tx')
    })
    await Promise.all(scriptHashes.map(async ([scripthash, balhash]) => {
      return provider.subscribeToAddress(scripthash)
    }))
  }

  async _updateScriptHashBalance (changeHash) {
    const { provider, state } = this
    const inlist = await state.getWatchedScriptHashes('in')
    const extlist = await state.getWatchedScriptHashes('ext')

    const process = async (data) => {
      await Promise.all(data.map(async ([scripthash, addr, path, balHash]) => {
        if (changeHash === balHash) return
        const txHistory = await provider.getAddressHistory({ cache: false },scripthash)
        await this._processHistory(addr, txHistory)
      }))
    }

    await process(extlist)
    await process(inlist)

    await state.addWatchedScriptHashes([], 'in')
    await Promise.all(inlist.map((scripthash) => {
      return provider.unsubscribeFromAddress(scripthash)
    }))
  }

  async watchAddress ([scriptHash, addr], addrType) {
    const { state, _max_script_watch: maxScriptWatch, provider } = this
    const hashList = await state.getWatchedScriptHashes(addrType)
    if (hashList.length >= maxScriptWatch) {
      hashList.shift()
    }
    const balHash = await provider.subscribeToAddress(scriptHash)
    if (balHash?.message) {
      throw new Error('Failed to subscribe to address ' + balHash.message)
    }
    hashList.push([scriptHash, addr, addr.path, balHash])
    await state.addWatchedScriptHashes(hashList, addrType)
  }

  async unlockUtxo (state) {
    return this._unspent.unlock(state)
  }

  async updateBlock (block) {
    if (block <= 0) throw new Error('invalid block height')
    if(this.currentBlock !== block && this.currentBlock !== 0){
      this.currentBlock = block
      //TODO: Update balance states on new block
      this._newBlock()
      return 
    }
    this.currentBlock = block
  }

  async _newBlock () {
    const { _addr } = this
    const pTx = (await this._addr.getTxHeight(this.currentBlock - 1)) || []

    const newTx = await Promise.all(pTx.map(async (tx) => {
      return await this.provider.getTransaction(tx.txid, { cache: false })
    }))


    const processTx = async (inout, tx) => {
      await Promise.all(tx[inout].map(async (utxo) => {
        const dbAddr = await _addr.get(utxo.address)
        if(!dbAddr) return
        return this._processHistory({address: utxo.address}, [tx])
      }))
    }
    await Promise.all(newTx.map(async (tx) => {
      await processTx('in', tx)
      await processTx('out', tx)
    }))

    if(newTx.length > 0) {
      this.emit('new-tx')
    }
  }

  async _processHistory (addr, txHistory) {
    const { _addr } = this

    const dbAddr = await _addr.get(addr.address)

    if (!dbAddr) {
      await _addr.newAddress(addr.address)
    }

    await _addr.storeTxHistory(txHistory)

    await Promise.all(txHistory.map(async (tx) => {
      const txState = this._getTxState(tx)
      await this._processUtxo(tx.out, 'out', txState, tx.fee, addr, tx.txid)
      await this._processUtxo(tx.in, 'in', txState, 0, addr, tx.txid)
    }))
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
    const txHistory = await provider.getAddressHistory({} ,scriptHash)

    if (Array.isArray(txHistory) && txHistory.length === 0) {
      // increase gap count if address has no tx
      gapCount++
    } else {
      await this._processHistory(addr, txHistory)
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
      // Update path tracking state to not reuse addresses
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
    const totalBalance = new Balance(0, 0, 0)
    totalBalance.mempool = total.out.mempool.minus(total.in.mempool)
    totalBalance.confirmed = total.out.confirmed.minus(total.in.confirmed)
    totalBalance.pending = total.in.pending.minus(total.out.pending).abs()
    return totalBalance
  }

  _getTxState (tx) {
    if (tx.height === 0) return 'mempool'
    // minimum number of confirmations before the tx is accepted
    const diff = this.currentBlock - tx.height
    if (diff >= this.minBlockConfirm) return 'confirmed'
    if(diff < this.minBlockConfirm && diff >= 0) return 'pending'
    throw new Error('tx height is invalid ' + tx.height)
  }

  async _processUtxo (utxoList, inout, txState, txFee = 0, addr, txid) {
    const { _addr, _total } = this

    return Promise.all(utxoList.map(async (utxo) => {
      utxo.address_public_key = addr.publicKey
      utxo.address_path = addr.path
      const bal = await _addr.get(utxo.address)

      if (utxo.address !== addr.address || !bal) return
      const point = inout === 'out' ? utxo.txid + ':' + utxo.index : utxo.prev_txid + ':' + utxo.prev_index

      // Prevent duplicate txid from being added
      // continue if changed and update state 
      // find which balance needs to be negated if exists
      // if eixsts already minus from state
      //
      _total[inout].addTxid(txState, point, utxo.value)
      bal[inout].addTxid(txState, point, utxo.value)
      if(txFee > 0) {
        _total.fee.addTxid(txState, point, txFee)
        bal.fee.addTxid(txState, point, txFee)
      }
      _addr.set(utxo.address, bal)
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
    const amount = new Bitcoin(value.amount, value.unit)
    return this._unspent.getUtxoForAmount(amount, strategy)
  }

  getTransactions (fn) {
    return this._addr.getTransactions(fn)
  }
}

module.exports = SyncManager
