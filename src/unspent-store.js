
const { Bitcoin } = require('../../wallet/src/currency.js')

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

module.exports = UnspentStore
