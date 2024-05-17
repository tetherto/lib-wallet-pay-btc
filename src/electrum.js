const { EventEmitter } = require('events')
const { Bitcoin } = require('../../wallet/src/currency.js')

class Electrum extends EventEmitter {

  constructor(config) {
    super()
    if(!config.host || !config.port) throw new Error('Network is required')
    this.port = config.port
    this.host = config.host
    this._net = config.net || require('net')
    this.clientState = 0
    this.requests = new Map()
    this.cache = new Map()
    this.block_height = 0
    this._max_cache_size = 100
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this._client = this._net.createConnection(this.port, this.host, (connect) => {
        this.clientState = 1
        resolve()
      })
      this._client.on('data', (data) => {
        const response = data.toString().split('\n')
        response.forEach((data) => {
          if(!data) return
          this._handleResponse(data)
        })
      })
      this._client.on('close', () => {
        this.clientState = 0
        this.emit('close')
      })
      this._client.on('error', (err) => {
        this.emit('error', err)
      })
    })
  }

  _handleResponse(data) {
    let resp
    try {
      resp = JSON.parse(data.toString())
    } catch(err) { 
      this.emit('request-error', err)
      return 
    }
    
    if(resp?.method?.includes('.subscribe')) {
      this.emit(resp.method, resp.params.pop())
      return
    }
    const _resp = this.requests.get(resp.id)
    const [resolve, reject, method] =_resp || []
    if(!resolve) return this.emit('error', `no handler for id: ${resp.method} - ${resp.id}`)

    resolve(resp.result || resp.error) 

    !method.includes('.subscribe') ? this.requests.delete(resp.id) : null
  }

  _getNewId () {
    const id = Date.now() +"_"+this.requests.size+"_"+parseInt(Math.random() * 1000) 
    this.requests.set(id, [])
    return id
  }

 _rpcPayload (method, params, id) {
    return JSON.stringify({
		  jsonrpc: '2.0',
      id,
      method,
      params
    })
  }

  async getAddressHistory(scriptHash) {
    let txData
    try {

      const history = await this._makeRequest('blockchain.scripthash.get_history', [scriptHash])
      txData = await Promise.all(history.map(async (tx, index) => {
        const txData = await this.getTransaction(tx.tx_hash, scriptHash)
        txData.height = history[index].height;
        return txData
      }))
    } catch(err) {
      return { error : err }
    }
    return txData
  }

  _processTxVout(vout) {
    return {
      address: this._getTxAddress(vout.scriptPubKey),
      value: new Bitcoin(vout.value, 'main'),
      witness_hex: vout.scriptPubKey.hex
    }
  }

  _getTransaction(txid) {
    return this._makeRequest('blockchain.transaction.get', [txid, true])
  }

  _getBalance(scriptHash) {
    return this._makeRequest('blockchain.scripthash.get_balance', [scriptHash])
  }

  async broadcastTransaction(tx) {
    return this._makeRequest('blockchain.transaction.broadcast', [tx])
  }

  async getTransaction(txid, sc) {
    const cache = this.cache
    const data = {
      txid,
      out : [],
      in : []
    }

    const getOrFetch = async (txid) => {

      if(cache.has(txid)) {
        return cache.get(txid)
      }
      const data = await this._getTransaction(txid)
      if(cache.size > this._max_cache_size) {
        cache.delete(cache.keys().next().value);
      }
      cache.set(txid, data)
      return data
    }

    const tx = await getOrFetch(txid)
    let totalOut = new Bitcoin(0, 'main')
    data.out = tx.vout.map((vout) => {
      const newvout = this._processTxVout(vout)
      newvout.index = vout.n
      newvout.txid = txid
      totalOut = totalOut.add(newvout.value)
      return newvout
    })

    let totalIn = new Bitcoin(0, 'main')
    data.in = await Promise.all(tx.vin.map(async (vin) => {
      const txDetail = await getOrFetch(vin.txid)
      const newvin = this._processTxVout(txDetail.vout[vin.vout])
      newvin.prev_txid = vin.txid
      newvin.prev_index = vin.vout
      newvin.txid = txid
      totalIn = totalIn.add(newvin.value)
      return newvin
    }))
    data.fee = totalIn.minus(totalOut)
    return data
  }

  _getTxAddress(scriptPubKey) {
    if(scriptPubKey.address) return scriptPubKey.address
    if(scriptPubKey.addresses) return scriptPubKey.addresses
    return null
  }

  async subscribeToBlocks() {
    this.on('blockchain.headers.subscribe', (height) => {
      this.block_height = height.height
      this.emit('new-block', height)
    })
    const height = await this._makeRequest('blockchain.headers.subscribe', [])
    this.block_height = height.height
    this.emit('new-block', height)
  }

  close() {
    this._client.end()
  }

  rpc(method, params) {
    return this._makeRequest(method, params)
  }

  _makeRequest (method, params) {
    return new Promise((resolve, reject) => {
      if(this.clientState !== 1) throw new Error('Not connected')
      const id = this._getNewId()
      const data = this._rpcPayload(method, params, id)
      this._client.write(data+"\n")
      this.requests.set(id, [resolve, reject, method])
    })
  }

  async ping (opts) {
    const res = await this._makeRequest('server.ping', [])
    if(!res) return 'pong'
    throw new Error('ping failed')
  }
}


module.exports = Electrum
