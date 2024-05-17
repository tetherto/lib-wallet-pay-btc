'use strict'
const { EventEmitter } = require('events')
const HdWallet = require('./hdwallet.js')
const { Bitcoin } = require('../../wallet/src/currency.js')

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

class UnspentStore {

  constructor() {
    this.vin = []
    this.vout = []
    this.ready = false
    this.locked = new Set()
  }

  add(utxo, vinout) {
    if(vinout === 'in') {
      this.vin.push(utxo)
    }
    if(vinout === 'out') {
      this.vout.push(utxo)
    }
  }

  process() {
    this.vout = this.vout.filter((utxo) => {
      return !this.vin.some((vin) => {
        return vin.prev_txid === utxo.txid && vin.prev_index === utxo.index
      })
    })
    this._sort()
    this.ready = true
  }

  _sort() {
    this.vout = this.vout.sort((a, b) => a.value.minus(b.value).toString())
  }

  lock(id) {
    const exists = this.vout.some((utxo) => utxo.txid === id )
    if(this.locked.has(id)) return false
    if(!exists) return false 
    this.locked.add(id)
    return true
  }

  getUtxoForAmount(amount, strategy) {
    if(!this.ready) throw new Error("not ready. tx in progress")
    this.ready = false
    // small to large
    return this._smallToLarge(amount)
  }

  unlock(state) {
    if(!state) {
      this.locked.clear()
      this.ready = true
      return 
    }

    this.locked.forEach((id) => {
      this.vout = this.vout.filter((utxo) => utxo.txid !== id)
    })
    this.locked.clear()
    this._sort()
    this.ready = true

  }


  _smallToLarge(amount) {
    let total = new Bitcoin(0, amount.type)
    let utxo = []
    for(let index in this.vout) {
      const v = this.vout[index]
      if(this.locked.has(v.txid)) continue
      total = total.add(v.value)
      utxo.push(v)
      this.locked.add(v.txid)
      if(total.gte(amount)) {
        break
      }
    }
    const diff = total.minus(amount)
    return {utxo, total, diff}
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
    this.reset()
  }

  ready() {
    return new Promise((resolve, reject) => {
      if(this.currentBlock > 0) resolve()
      else {
        this.once('new-block', () => resolve())
      }
    })
  }

  unlockUtxo(state) {
    this._unspent.unlock(state)
  }

  updateBlock(block) {
    if( block <= 0 ) throw new Error("invalid block height")

    this.currentBlock = block
    this.emit('new-block', block)

  }

  async _processPath(path, gapEnd, gapCount) {
    const { keyManager, provider, gapLimit, _addr, _halt } = this

    if(_halt === true || gapCount >= gapLimit) {
      return [false, null, null, null]
    }
    let hasBalance = false
    const [scriptHash, addr] = keyManager.pathToScriptHash(path, HdWallet.getAddressType(path))
    const txHistory = await provider.getAddressHistory(scriptHash)


    if(txHistory.length === 0) {
      gapCount++ 
    } else {
      if(!_addr.has(addr)) {
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
      const data = _addr.get(addr.address)
      if(data) {
        let difference = new Set();
        for (let elem of data.outtxid) {
            if (!data.intxid.has(elem)) {
                difference.add(elem);
            }
        }
        data.intxid = null
        data.outtxid = difference
      }
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
  }

  async syncAccount(pathType, opts) {
    if(this._halt) throw new Error("already syncing")

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
      count++ 
      syncState[pathType].path = path
      syncState[pathType].gap = gapCount
      syncState[pathType].gapEnd = gapEnd
      await state.setSyncState(syncState)
      this.emit('synced-path', pathType, path, hasBalance, [gapCount, this.gapLimit, gapEnd])
    })

    if(this._halt) return 
    this._unspent.process()
  }

  getBalance(addr) {
    let total
    if(!addr) {
      total = this._total 
    } else {
      total = this._addr.get(addr)
      if(!total) throw new Error('Address not found '+ addr)
    }
    const totalBalance = new Balance(0, 0, 0)
    totalBalance.mempool = total.out.mempool.minus(total.in.mempool)
    totalBalance.confirmed = total.out.confirmed.minus(total.in.confirmed)
    totalBalance.pending = total.in.pending.minus(total.out.pending)
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
      if(utxo.address === addr.address && _addr.has(utxo.address)){
        const bal = _addr.get(utxo.address)
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
      }
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
