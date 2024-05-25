'use strict'
const { EventEmitter } = require('events')
const HdWallet = require('./hdwallet.js')
const { Bitcoin } = require('../../wallet/src/currency.js')
const UnspentStore = require('./unspent-store.js')

class Balance {

  constructor(confirmed, pending, mempool) {
    this.confirmed = new Bitcoin(confirmed, 'main')
    this.pending = new Bitcoin(pending,'main')
    this.mempool = new Bitcoin(mempool, 'main')
  }
}

class AddressManager {

  constructor(config) {
    this.store = config.store.newInstance({ name : 'addr'})
  }

  async init() {
    await this.store.init()
  }

  _newAddr() {
    return {
      // @desc total balances for VIN and VOUTS
      in : new Balance(0, 0, 0), 
      out : new Balance(0 ,0, 0),
      // @desc: transaction fee totals
      fee: new Balance(0,0,0),
      // @desc: txid of processsed vins and vouts
      intxid : [],
      outtxid : [],
    } 
  }

  async has(addr) {
    return !! this.get(addr)
  }

  async clear() {
    this.store.clear()
  }

  async newAddress(addr) {
    const data = this._newAddr()
    await this.store.put(addr, data)
    return data
  }

  set(addr, data) {
    return this.store.put(addr, data)
  }

  get(addr) {
    return this.store.get(addr)
  }
}


class SyncManager extends EventEmitter {
  constructor(config) {
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

  init() {
    return new Promise(async (resolve, reject) => {
      await this._subscribeToScriptHashes()
      this._total = await this.state.getTotalBalance()
      this._addr = new AddressManager({ store: this.store }) 
      await this._addr.init()
      this._unspent = new UnspentStore({ store: this.store })
      await this._unspent.init()
      resolve()
    })
  }
  
  reset() {
    const total = {
      in : new Balance(0,0,0), 
      out: new Balance(0,0,0),
      fee: new Balance(0,0,0)
    }
    this._total = this.state.setTotalBalance(total) 
    this.resumeSync()
    this.state.resetSyncState()
  }

  async _subscribeToScriptHashes() {
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

  async _updateScriptHashBalance(changeHash) {
    const { provider, state } = this
    const inlist = await state.getWatchedScriptHashes('in')
    const extlist = await state.getWatchedScriptHashes('ext')
    const data = inlist.concat(extlist)

    const process = async (data) => {
      await Promise.all(data.map(async ([scripthash, addr, path, balHash]) => {
        if(changeHash === balHash) return 
        const txHistory = await provider.getAddressHistory(scripthash)
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

  async watchAddress([scriptHash, addr], addrType,) { 
    const { state, _max_script_watch, provider } = this
    const hashList = await state.getWatchedScriptHashes(addrType)
    if(hashList.length >= _max_script_watch) {
      hashList.shift()
    }
    const balHash = await provider.subscribeToAddress(scriptHash)
    if(balHash?.message) {
      throw new Error('Failed to subscribe to address '+ balHash.message)
    }
    hashList.push([scriptHash, addr, addr.path, balHash])
    await state.addWatchedScriptHashes(hashList, addrType)
  }

  async unlockUtxo(state) {
    return this._unspent.unlock(state)
  }

  updateBlock(block) {
    if( block <= 0 ) throw new Error("invalid block height")
    this.currentBlock = block
  }

  async _processHistory(addr, txHistory) {
    const { _addr } = this

    if(txHistory.length === 0 || !txHistory.map) return console.log('txhistory not found ', txHistory) 

    if(!await _addr.has(addr.address)) {
      await _addr.newAddress(addr.address)
    }

    await Promise.all(txHistory.map(async (tx) => {
      const txState = this._getTxState(tx)
      await this._processUtxo(tx.out, 'out', txState, tx.fee, addr ,tx.txid)
      await this._processUtxo(tx.in, 'in', txState, 0, addr, tx.txid)
    }))
  }

  /**
  * @description process a path for transactions/history and count gap limit.
  */
  async _processPath(path, gapEnd, gapCount) {
    const { keyManager, provider, gapLimit, _halt } = this

    if(_halt === true || gapCount >= gapLimit) {
      return [false, null, null, null]
    }
    let hasTx = false
    const [scriptHash, addr] = keyManager.pathToScriptHash(path, HdWallet.getAddressType(path))
    const txHistory = await provider.getAddressHistory(scriptHash)

    if(Array.isArray(txHistory) && txHistory.length === 0) {
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

  async syncAccount(pathType, opts) {
    if(this._halt || this._isSyncing) throw new Error("already syncing")
    const { gapLimit, hdWallet, state } = this
    this._isSyncing = true

    let syncState = await state.getSyncState(opts)
    const syncType = syncState[pathType]
    let gapEnd = gapLimit
    let gapCount = syncType.gap
    let done, hasTx
    if(syncType.gap >= gapLimit) return
    let count = 0
    await hdWallet.eachAccount(pathType, syncType.path, async (path, halt) => {
      let res = await this._processPath(path, gapEnd, gapCount)
      let [done, hasTx] = res
      gapEnd = res[2]
      gapCount = res[3]
      if(!done) return halt()
      // Update path tracking state to not reuse addresses
      if(hasTx) {
        hdWallet.updateLastPath(HdWallet.bumpIndex(path))
      }
      count++ 
      syncState[pathType].path = path
      syncState[pathType].gap = gapCount
      syncState[pathType].gapEnd = gapEnd
      await state.setSyncState(syncState)
      this.emit('synced-path', pathType, path, hasTx, [gapCount, gapLimit, gapEnd])
    })

    if(this._halt) {
      this._isSyncing = false
      return 
    } 
    await this._unspent.process()
    this._isSyncing = false
  }

  getBalance(addr) {
    let total
    if(!addr) {
      total = this._total 
    } else {
      total = this._addr.get(addr)
      if(!total) throw new Error('Address not valid or not processed for balance '+ addr)
    }
    const totalBalance = new Balance(0, 0, 0)
    totalBalance.mempool = total.out.mempool.minus(total.in.mempool)
    totalBalance.confirmed = total.out.confirmed.minus(total.in.confirmed)
    totalBalance.pending = total.in.pending.minus(total.out.pending).abs()
    return totalBalance
  }

  _getTxState(tx) {
    if(tx.height === 0) return 'mempool'
    // minimum number of confirmations before the tx is accepted
    if(this.currentBlock - tx.height >= this.minBlockConfirm) return 'confirmed'
    return 'pending'
  }

  async _processUtxo(utxoList, inout, txState, txFee = 0, addr, txid) {
    const { _addr, _total }  = this

    return Promise.all(utxoList.map(async (utxo) => {
      utxo.address_public_key = addr.publicKey
      utxo.address_path = addr.path
      const bal = _addr.get(utxo.address)
      if(utxo.address !== addr.address || !bal) return 
      const point = inout === 'out' ? utxo.txid +':'+ utxo.index : utxo.prev_txid +':'+ utxo.prev_index

      // Prevent duplicate txid from being added
      if((inout === 'in' && bal.intxid.includes(point)) || (inout === 'out' && bal.outtxid.includes(point))) return

      bal[inout][txState] = bal[inout][txState].add(utxo.value)
      _total[inout][txState] = _total[inout][txState].add(utxo.value)

      if(inout === 'out') {
        bal.fee[txState] = bal.fee[txState].add(txFee)
        bal.outtxid.push(point)
      } else {
        bal.intxid.push(point)
      }
      _addr.set(utxo.address, bal)
      await this._unspent.add(utxo, inout)
      await this.state.setTotalBalance(_total)
    }))
  }

  stopSync() {
    this._halt = true 
  }

  resumeSync() {
    this._halt = false
  }

  isStopped() { return this._halt }

  async utxoForAmount(value, strategy) {
    const amount = new Bitcoin(value.amount, value.unit)
    return this._unspent.getUtxoForAmount(amount, strategy)
  }

  getTransactions(opts) {
    return this._syncManager.getTransactions(opts)
  }
}

module.exports = SyncManager
