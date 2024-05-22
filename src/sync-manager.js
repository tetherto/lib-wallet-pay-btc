'use strict'
const { EventEmitter } = require('events')
const HdWallet = require('./hdwallet.js')
const { Bitcoin } = require('../../wallet/src/currency.js')
const UnspentStore = require('./unspent-store.js')

class UTXOManager {

  constructor(config) {
    this.store = config.store
  }
  
  async init() {
    await this.store.init()
  }

  utxoForAmount(amount, config) {
    // Filter spent utxo 
    const utxos = this.store.keys('tx_')
    const selected = utxos.filter((utxo) => {
      if(utxos.height == 0 ) return false 
      return true
    })
    return selected
  }

  storeTxs(txs) {
    return Promise.all(txs.map(async (tx) => {
      return this.store.put(`tx_${tx.txid}`, tx)
    }))
  }
  
  async getTx(txid) {
    return this.store.get(`tx_${txid}`)
  }

  queryTx(query) {
    const txs = this.store.keys('tx_')
    return txs 
  }
}

class Balance {

  constructor(confirmed, pending, mempool) {
    this.confirmed = new Bitcoin(confirmed, 'main')
    this.pending = new Bitcoin(pending,'main')
    this.mempool = new Bitcoin(mempool, 'main')
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
    this._halt = false
    this._isSyncing = false
    this._max_script_watch = config.max_script_watch || 10
    this.reset()
  }

  init() {
    return new Promise(async (resolve, reject) => {
      await this._subscribeToScriptHashes()
      resolve()
    })
  }

  async _subscribeToScriptHashes() {
    const scriptHashes = await this.state.getWatchedScriptHashes()
    this.provider.on('new-tx', async (changeHash) => {
      await this._updateScriptHashBalance(changeHash)
      this.emit('new-tx')
    })
    await Promise.all(scriptHashes.map(async ([scripthash, balhash]) => {
      return this.provider.subscribeToAddress(scripthash)
    }))
  }

  async _updateScriptHashBalance(changeHash) {
    const { provider, state } = this
    const data = await state.getWatchedScriptHashes()

    await Promise.all(data.map(async ([scripthash, addr, path, balHash]) => {
      if(changeHash === balHash) return 
      const txHistory = await provider.getAddressHistory(scripthash)
      await this._processHistory(addr, txHistory)
    }))

  }

  async watchAddress([scriptHash, addr]) { 
    const hashList = await this.state.getWatchedScriptHashes()
    if(hashList.length >= this._max_script_watch) {
      hashList.shift()
    }
    const balHash = await this.provider.subscribeToAddress(scriptHash)
    if(balHash?.message) {
      throw new Error('Failed to subscribe to address '+ balHash.message)
    }
    hashList.push([scriptHash, addr, addr.path, balHash])
    await this.state.addWatchedScriptHashes(hashList)
  }

  unlockUtxo(state) {
    this._unspent.unlock(state)
  }

  updateBlock(block) {
    if( block <= 0 ) throw new Error("invalid block height")
    this.currentBlock = block
  }

  async _processHistory(addr, txHistory) {
    const { _addr } = this
    if(!_addr.has(addr.address)) {
      _addr.set(addr.address,{
        in : new Balance(0, 0, 0), 
        out : new Balance(0 ,0, 0),
        fee: new Balance(0,0,0),
        intxid : new Set(),
        outtxid : new Set(),
      })
    }


    await Promise.all(txHistory.map((tx) => {
      const txState = this._getTxState(tx)
      this._processUtxo(tx.out, 'out', txState, tx.fee, addr ,tx.txid)
      this._processUtxo(tx.in, 'in', txState, 0, addr, tx.txid)
    }))
  }

  async _processPath(path, gapEnd, gapCount) {
    const { keyManager, provider, gapLimit, _halt } = this

    if(_halt === true || gapCount >= gapLimit) {
      return [false, null, null, null]
    }
    let hasBalance = false
    const [scriptHash, addr] = keyManager.pathToScriptHash(path, HdWallet.getAddressType(path))
    const txHistory = await provider.getAddressHistory(scriptHash)

    if(Array.isArray(txHistory) && txHistory.length === 0) {
      gapCount++ 
    } else {
      await this._processHistory(addr, txHistory)
      gapEnd++
      gapCount = 0
      hasBalance = true
    }

    return [true, hasBalance, gapEnd, gapCount]
  }

  reset() {
    this._total = {
      in : new Balance(0,0,0), 
      out: new Balance(0,0,0),
      fee: new Balance(0,0,0)
    }
    this._addr = new Map()
    this._unspent = new UnspentStore()
    this.resumeSync()
    this.state.resetSyncState()
  }

  async syncAccount(pathType, opts) {
    if(this._halt || this._isSyncing) throw new Error("already syncing")
    this._isSyncing = true

    const { gapLimit, hdWallet, state } = this

    let syncState = await state.getSyncState(opts)
    const syncType = syncState[pathType]
    let gapEnd = gapLimit
    let gapCount = syncType.gap
    let done, hasBalance
    if(syncType.gap >= gapLimit) return
    let count = 0
    await hdWallet.eachAccount(pathType, syncType.path, async (path, halt) => {
      let res = await this._processPath(path, gapEnd, gapCount)
      let [done, hasBalance] = res
      gapEnd = res[2]
      gapCount = res[3]
      if(!done) return halt()
      // Update path tracking to not reuse addresses
      if(hasBalance) {
        hdWallet.updateLastPath(HdWallet.bumpIndex(path))
      }
      count++ 
      syncState[pathType].path = path
      syncState[pathType].gap = gapCount
      syncState[pathType].gapEnd = gapEnd
      await state.setSyncState(syncState)
      this.emit('synced-path', pathType, path, hasBalance, [gapCount, this.gapLimit, gapEnd])
    })

    if(this._halt) {
      this._isSyncing = false
      return 
    } 
    this._unspent.process()
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

  _processUtxo(utxoList, inout, txState, txFee = 0, addr, txid) {
    const { _addr, _total }  = this

    utxoList.forEach((utxo) => {
      utxo.address_public_key = addr.publicKey
      utxo.address_path = addr.path
      const bal = _addr.get(utxo.address)
      if(utxo.address !== addr.address || !bal) return 

      // Prevent duplicate txid from being added
      if((inout === 'in' && bal.intxid.has(txid)) || (inout === 'out' && bal.outtxid.has(txid))) return 

      bal[inout][txState] = bal[inout][txState].add(utxo.value)
      _total[inout][txState] = _total[inout][txState].add(utxo.value)

      if(inout === 'out') {
        bal.fee[txState] = bal.fee[txState].add(txFee)
        bal.outtxid.add(txid)
      } else {
        bal.intxid.add(utxo.prev_txid)
      }
      _addr.set(utxo.address, bal)
      this._unspent.add(utxo, inout)
    })
  }

  stopSync() {
    this._halt = true 
  }

  resumeSync() {
    this._halt = false
  }

  isStopped() { return this._halt }

  utxoForAmount(value, strategy) {
    const amount = new Bitcoin(value.amount, value.unit)
    return this._unspent.getUtxoForAmount(amount, strategy)
  }
}

module.exports = {
  UTXOManager,
  SyncManager
}
