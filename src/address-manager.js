const Bitcoin = require('./currency')

class Balance {
  constructor (confirmed, pending, mempool, txid) {
    // @desc: confirmed balance. Tx that have more than X amount of confirmations
    this.confirmed = new Bitcoin(confirmed, 'main')
    // @desc: pending balance. Tx that have less than X amount of confirmations but more than 0
    this.pending = new Bitcoin(pending, 'main')
    // @desc: mempool balance. Tx that are in the mempool, 0 confirmations
    this.mempool = new Bitcoin(mempool, 'main')

    this.txid = txid || {
      confirmed: [],
      pending: [],
      mempool: []
    }
  }

  addTxid (state, txid, amount) {
    for (const state in this.txid) {
      this.txid[state] = this.txid[state].filter(([tx]) => {
        if (tx === txid) {
          this.minusBalance(state, amount)
          return false
        }
        return true
      })
    }
    this.addBalance(state, amount)
    this.txid[state].push([txid, amount])
  }

  getTx (state, key) {
    return this.txid[state].filter(([tx]) => {
      return tx === key
    }).pop()
  }

  addBalance (state, amount) {
    this[state] = this[state].add(amount)
  }

  minusBalance (state, amount) {
    this[state] = this[state].minus(amount)
  }

  combine (t2) {
    const total = new Balance(0, 0, 0)
    total.mempool = this.mempool.minus(t2.mempool)
    total.confirmed = this.confirmed.minus(t2.confirmed)
    total.pending = this.pending.minus(t2.pending)
    return total.formatted()
  }

  formatted () {
    return {
      confirmed: this.confirmed,
      pending: this.pending,
      mempool: this.mempool,
      consolidated: this.confirmed.add(this.pending).add(this.mempool)
    }
  }
}

const MAX_BLOCK_SIZE = 100
class AddressManager {
  constructor (config) {
    // @desc: address store that keeps track of balances
    this.store = config.store.newInstance({ name: 'addr' })
    // @desc: transaction history store that holds tx details from electrum
    this.history = config.store.newInstance({ name: 'tx-history' })
    // @desc: Transactions that has been broadcasted
    this.outgoings = config.store.newInstance({ name: 'broadcasted' })
  }

  async init () {
    await this.store.init()
    await this._setHistoryIndex()
  }

  async close () {
    await this.store.close()
    await this.history.close()
  }

  _newAddr () {
    return {
      in: new Balance(0, 0, 0),
      out: new Balance(0, 0, 0),
      fee: new Balance(0, 0, 0)
    }
  }

  async has (addr) {
    return !!this.get(addr)
  }

  async clear () {
    await this.store.clear()
    await this.history.clear()
    await this.outgoings.clear()
  }

  async newAddress (addr) {
    const exist = await this.get(addr)
    if (exist) return exist
    const data = this._newAddr()
    await this.store.put(addr, data)
    return data
  }

  set (addr, data) {
    return this.store.put(addr, data)
  }

  async get (addr) {
    const data = await this.store.get(addr)
    if (!data) return null
    return {
      in: new Balance(data.in.confirmed, data.in.pending, data.in.mempool, data.in.txid),
      out: new Balance(data.out.confirmed, data.out.pending, data.out.mempool, data.out.txid),
      fee: new Balance(data.fee.confirmed, data.fee.pending, data.fee.mempool, data.fee.txid)
    }
  }

  async _setHistoryIndex () {
    const index = await this._getIndex()
    if (!index) {
      await this.history.put('max_block_size', MAX_BLOCK_SIZE)
      this._max_block_size = MAX_BLOCK_SIZE
      return this._setIndex(index)
    }
    this._max_block_size = await this.history.get('max_block_size')
    return index
  }

  _getIndex () {
    return this.history.get('index')
  }

  _setIndex (index) {
    return this.history.put('index', index)
  }

  /**
  * @desc Get transaction history by block height
  */
  getTxHeight (height) {
    return this.history.get('i:' + height)
  }

  /**
  * @desc Remove transaction from mempool store
  *       Mempool transactions have 0 height.
  *       When they are confirmed they must be removed to prevent duplicate tx being kept in store
  * @param {String} txid - transaction id
  */
  async _removeFromMempool (txid) {
    let mp = await this.history.get('i:' + 0) || []
    let mpx = null

    for (const x in mp) {
      mpx = mp[x]
      if (mpx.txid === txid) {
        mp.splice(x, 1)
        break
      }
    }
    if (mp.length === 0) {
      mp = null
    }
    await this.history.put('i:' + 0, mp)
    return mpx
  }

  /**
  * @desc Store transaction history in history store
  **/
  async storeTxHistory (history) {
    for (const tx of history) {
      let heightTx = await this.getTxHeight(tx.height)
      if (!heightTx) {
        heightTx = []
      } else {
        const exists = heightTx.some(htx => htx.txid === tx.txid)
        if (exists) {
          continue
        }
      }
      const mtx = await this._removeFromMempool(tx.txid)
      if (mtx) {
        tx.mempool_ts = mtx.mempool_ts
      }
      heightTx.push(tx)
      await this.history.put('i:' + tx.height, heightTx)
    }
  }

  getMempoolTx () {
    return this.history.get('i:' + 0)
  }

  /**
  * @desc get transaction history from history store
  * @param {function} fn callback function to process each transaction
  * @returns {Promise}
  */
  async getTransactions (fn) {
    return this.history.entries(async (key, value) => {
      if (key.indexOf('i:') !== 0 || !value) return
      return await fn(value)
    })
  }

  addSentTx (tx) {
    return this.outgoings.put(tx.txid, tx)
  }

  getSentTx (txid) {
    return this.outgoings.get(txid)
  }
}

module.exports = {
  AddressManager,
  Balance
}
