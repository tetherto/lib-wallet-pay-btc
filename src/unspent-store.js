// Copyright 2024 Tether Operations Limited
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

'use strict'
const Bitcoin = require('./currency')

/**
 * @description Class for storing Bitcoin VIN and VOUT
**/
class VinVout {
  constructor (config, vtype) {
    this.store = config.store
    this.vtype = config.vtype
  }

  async init () {

  }

  async push (utxo) {
    const key = this.vtype === 'vout' ? utxo.txid + ':' + utxo.index : utxo.prev_txid + ':' + utxo.prev_index
    if (await this.store.get(key)) return
    return this.store.put(key, utxo)
  }

  async filter (cb) {
    return this.store.entries(async (k, v) => {
      const bool = await cb(v)
      if (!bool) {
        await this.store.delete(k)
      }
    })
  }

  async entries (cb) {
    return this.store.entries(async (k, v) => { fb
      v.value = new Bitcoin(v.value)
      await cb(v, k)
    })
  }

  async some (cb) {
    return this.store.some(async (k, v) => {
      v.value = new Bitcoin(v.value)
      return cb(v)
    })
  }

  get (key) {
    return this.store.get(key)
  }
}

/**
 * @description class for tracking vin and vout, for spending btc
*/
class UnspentStore {
  constructor (config) {
    this.store = config.store.newInstance({ name: 'utxo' })
    this.vin = new VinVout({
      store: config.store.newInstance({ name: 'utxo-vin' }),
      vtype: 'vin'
    })
    this.vout = new VinVout({
      store: config.store.newInstance({ name: 'utxo-vout' }),
      vtype: 'vout'
    })
    this.ready = false
  }

  async init () {
    await this.vin.init()
    await this.vout.init()
    this.locked = await this.store.get('utxo_lock') || []
    this._lockedUtxo = []
    this._spentUtxo = []
  }

  async close () {
    await this.store.close()
    await this.vout.store.close()
    await this.vin.store.close()
  }

  async clear () {
    await this.vin.clear()
    await this.vout.clear()
    await this._resetLock()
  }

  async add (utxo, vinout) {
    if (vinout === 'in') {
      await this.vin.push(utxo)
    } else if (vinout === 'out') {
      await this.vout.push(utxo)
    } else {
      throw new Error('invalid param ' + vinout)
    }
  }

  // @desc: remove utxo that has been spent using the vin set
  async process () {
    await this.vout.filter(async (utxo) => {
      return !(await this.vin.some((vin) => {
        return vin.prev_txid === utxo.txid && vin.prev_index === utxo.index
      }))
    })
    this.ready = true
  }

  /** desc: lock a ouput **/
  async lock (id) {
    const exists = await this.vout.some((utxo) => utxo.txid === id)
    if (this.locked.includes(id) || !exists) return false
    this.locked.push(id)
    return true
  }

  getUtxoForAmount (amount, strategy) {
    if (!this.ready) throw new Error('not ready. tx in progress')
    this.ready = false
    // small to large
    return this._smallToLarge(amount)
  }

  /**
  * @description unlock locked outputs for spending.
  * @param {boolean} state if true, remove locked outputs from vout set. if FALSE, reset lock
  */
  async unlock (state) {
    if (!state) {
      this.locked = []
      this.ready = true
      return
    }

    await Promise.all(this.locked.map(async (id) => {
      this._spentUtxo.push(id)
      return this.vout.filter((utxo) => utxo.txid !== id)
    }))

    this.locked = []
    this.ready = true
  }

  /**
  * @description collect unspent outputs for performing a tx
  * TODO: ADD UTXO selection args here
  */
  async _smallToLarge (amount) {
    let total = new Bitcoin(0, amount.type)
    const utxo = []
    let done = false

    await this.vout.entries(async (v) => {
      if (this.locked.includes(v.txid) || done) return
      if (this._spentUtxo.includes(v.txid) || done) return
      total = total.add(v.value)
      utxo.push(v)
      await this.lock(v.txid)
      if (total.gte(amount)) {
        // TODO: SOME loop
        done = true
      }
    })
    const diff = total.minus(amount)

    if (utxo.length === 0) {
      throw new Error('Insufficient funds or no utxo available')
    }

    if (diff.toNumber() < 0) {
      throw new Error('Have utxo but insufficient funds')
    }
    return { utxo, total, diff }
  }
}

module.exports = UnspentStore
