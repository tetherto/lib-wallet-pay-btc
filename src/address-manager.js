const { Bitcoin } = require('../../wallet/src/currency.js')

class Balance {
  constructor (confirmed, pending, mempool) {
    // @desc: confirmed balance. Tx that have more than X amount of confirmations 
    this.confirmed = new Bitcoin(confirmed, 'main')
    // @desc: pending balance. Tx that have less than X amount of confirmations
    this.pending = new Bitcoin(pending, 'main')
    // @desc: mempool balance. Tx that are in the mempool, 0 confirmations
    this.mempool = new Bitcoin(mempool, 'main')
  }
}

const MAX_BLOCK_SIZE = 100

class AddressManager {
  constructor (config) {
    // @desc: address store that keeps track of balances
    this.store = config.store.newInstance({ name: 'addr' })
    // @desc: transaction history store that holds tx details from eletrum
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
      // @desc total balances for VIN and VOUTS
      in: new Balance(0, 0, 0),
      out: new Balance(0, 0, 0),
      // @desc: transaction fee totals
      fee: new Balance(0, 0, 0),
      // @desc: txid of processsed vins and vouts
      intxid: [],
      outtxid: []
    }
  }

  async has (addr) {
    return !!this.get(addr)
  }

  async clear () {
    this.store.clear()
  }

  async newAddress (addr) {
    const data = this._newAddr()
    await this.store.put(addr, data)
    return data
  }

  set (addr, data) {
    return this.store.put(addr, data)
  }

  async get (addr) {
    const data = await this.store.get(addr)
    if(!data) return null
    return {
      in : new Balance(data.in.confirmed, data.in.pending, data.in.mempool),
      out : new Balance(data.out.confirmed, data.out.pending, data.out.mempool),
      fee : new Balance(data.fee.confirmed, data.fee.pending, data.fee.mempool),
      intxid: data.intxid,
      outtxid: data.outtxid
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
  _getTxHeight (height) {
    return this.history.get(height)
  }

  /**
  * @desc Remove transaction from mempool store
  *       Mempool transactions have 0 height. 
  *       When they are confirmed they must be removed to prevent duplicate tx being kept in store
  * @param {String} txid - transaction id
  */
  async _removeFromMempool (txid) {
    const mp = await this.history.get('i:' + 0) || []
    for (const x in mp) {
      if (mp[x].txid === txid) {
        mp.splice(x, 1)
        return
      }
    }
  }

  /**
  * @desc Store transaction history in history store
  **/
  storeTxHistory (history) {
    return Promise.all(history.map(async (tx) => {
      const height = tx.height === 0 ? 'mempool' : tx.height
      let heightTx = await this._getTxHeight(tx.height)
      if (!heightTx) {
        heightTx = []
      } else {
        const exists = heightTx.some(htx => htx.txid === tx.txid)
        if (exists) return
      }
      await this._removeFromMempool(tx)
      heightTx.push(tx)
      return this.history.put('i:' + height, heightTx)
    }))
  }

  /**
  * @desc et transaction history from history store
  * @param {function} fn callback function to process each transaction
  * @returns {Promise}
  */
  getTransactions (fn) {
    return this.history.entries(async (key, value) => {
      if (key.indexOf('i:') !== 0) return
      return await fn(value)
    })
  }

  addSentTx (tx) {
    return this.outgoings.put(tx.txid, tx)
  }

  getSentTx(txid) {
    return this.outgoings.get(txid)
  }
}

module.exports = {
  AddressManager,
  Balance
}
