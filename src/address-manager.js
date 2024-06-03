const { Bitcoin } = require('../../wallet/src/currency.js')

class Balance {
  constructor (confirmed, pending, mempool) {
    this.confirmed = new Bitcoin(confirmed, 'main')
    this.pending = new Bitcoin(pending, 'main')
    this.mempool = new Bitcoin(mempool, 'main')
  }
}

const MAX_BLOCK_SIZE = 100

class AddressManager {
  constructor (config) {
    this.store = config.store.newInstance({ name: 'addr' })
    this.history = config.store.newInstance({ name: 'tx-history' })
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

  _getTxHeight (height) {
    return this.history.get(height)
  }

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
  * @desc Store transaction history in a self balancing btree
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

  getTransactions (fn) {
    return this.history.entries(async (key, value) => {
      if (key.indexOf('i:') !== 0) return
      return await fn(value)
    })
  }
}

module.exports = {
  AddressManager,
  Balance
}
