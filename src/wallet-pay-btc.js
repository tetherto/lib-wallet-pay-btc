const { WalletPay, HdWallet } = require('lib-wallet')
const { EventEmitter, once } = require('events')
const Transaction = require('./transaction.js')
const SyncManager = require('./sync-manager.js')
const Bitcoin = require('./currency')

const WalletPayError = Error



class StateDb {
  constructor (config) {
    this.store = config.store
  }

  async init () {
    await this.store.init()
  }

  async updateReceiveBalance (balance) {
    return this.store.put('receive_balance', balance)
  }

  async addWatchedScriptHashes (list, addrType) {
    return this.store.put('watched_script_hashes_' + addrType, list)
  }

  async getWatchedScriptHashes (addrType) {
    return await (this.store.get('watched_script_hashes_' + addrType)) || []
  }

  async setTotalBalance (balance) {
    return this.store.put('total_balance', balance)
  }

  async getTotalBalance () {
    return this.store.get('total_balance')
  }

  async getLatestBlock () {
    return await (this.store.get('latest_block')) || 0
  }

  async setLatestBlock (block) {
    return this.store.put('latest_block', block)
  }

}

/**
* @desc BlockCounter: Used to track block height within wallet.
* @param {Object} config - Config
* @param {Object} config.state - state instance for storing block height
* @emits {Object} new-block - new block
* @emits {Object} block - block
* @emits {Object} diff - diff
* @emits {Object} last - last block
* */
class BlockCounter extends EventEmitter {
  constructor (config) {
    super()
    this.state = config.state
  }

  async init () {
    this.block = await this.state.getLatestBlock()
  }

  async setBlock (newBlock) {
    const {height, hash } = newBlock

    const diff = height - this.block
    const last = this.block
    if(diff < 0 ) {
      // Block reorg? 
      console.log('block reorg detected')
      return 
    } 

    this.block = height
    await this._emitBlock({
      current: height,
      diff: diff,
      last
    })
    this.state.setLatestBlock(this.block)
    return true
  }

  async _emitBlock(block) {
    const events = this.rawListeners('new-block')

    await Promise.all(events.map(async (event) => {
      return event(block)
    }))

  }
}

class WalletPayBitcoin extends WalletPay {
  static networks = ['regtest', 'mainnet', 'testnet', 'signet', 'bitcoin']
  static events = ['ready', 'synced-path', 'new-tx']


  /**
  * @desc WalletPayBitcoin
  * @param {Object} config - Config
  * @param {Object} [config.provider=Electrum]- block data provider
  * @param {Object} [electrum config]. See Electrum.js for all options
  * @param {Object} config.store - store instance
  * @param {Object} [config.key_manager=WalletKeyBtc] - key manager instance. 
  * @param {Seed} config.seed - seed for key manager.
  * @param {String} config.network - blockchain network
  * @param {Number} [config.gapLimit=20] - gap limit. How far to look ahead when scanning for balances
  * @param {Number} [config.min_block_confirm=1] - minimum number of block confirmations
  **/ 
  constructor (config) {

    super(config)
    if (!WalletPayBitcoin.networks.includes(this.network)) throw new WalletPayError('Invalid network')
    
    this._electrum_config = config.electrum || {}
    this.gapLimit = config.gapLimit || 20
    this.min_block_confirm = config.min_block_confirm || 1
    this.ready = false
    this.currency = Bitcoin
    this.keyManager = config.key_manager || null
    this._addressType = 'p2wpkh'
  }

  async destroy () {
    await this.provider.close()
    await this.pauseSync()
    await this._syncManager.close()
    await this.state.store.close()
    await this._hdWallet.close()
    await this.keyManager.close()
    await this._postDestroy()
  }

  async initialize (wallet) {
    if (this.ready) return 

    // @desc use default key manager
    if(!this.keyManager) {
      this.keyManager = new (require('./wallet-key-btc.js'))({ seed: wallet.seed, network: this.network })
    }

    // Add asset to wallet
    await super.initialize(wallet)

    if(!this.keyManager.network) {
      this.keyManager.setNetwork(this.network)
    }
    
    if(!this.provider) {
      this._electrum_config.store = this.store
      this.provider = new (require('./electrum.js'))(this._electrum_config)
    }
    
    this._hdWallet = new HdWallet({ 
      store: this.store.newInstance({ name: 'hdwallet' }),
      coinType: "0'",
      purpose: "84'",
      gapLimit: this.gapLimit
    })
    this.state = new StateDb({
      store: this.store.newInstance({ name: 'state' })
    })

    
    if(!this.provider.isConnected()) {
      await this.provider.connect()
    }
    
    this._syncManager = new SyncManager({
      state: this.state,
      gapLimit: this.gapLimit,
      hdWallet: this._hdWallet,
      utxoManager: this._utxoManager,
      provider: this.provider,
      keyManager: this.keyManager,
      currentBlock: this.latest_block,
      minBlockConfirm: this.min_block_confirm,
      store: this.store,
      addressType: this._addressType
    })

    this.block = new BlockCounter({ state : this.state })
    await this.block.init()
    this.block.on('new-block', async (block) => {
      this.emit('new-block', block)
      await this._syncManager.updateBlock(block)
    })


    await this.state.init()
    await this._syncManager.init()
    await this._hdWallet.init()
    const electrum = new Promise((resolve) => {
      this.provider.once('new-block', (block) => {
        this.ready = true
        this.emit('ready')
        resolve()
      })
    })

    this.provider.on('new-block', async (block) => {
      this.block.setBlock(block)
    })
    await this.provider.subscribeToBlocks()

    this._syncManager.on('synced-path', (...args) => {
      this.emit('synced-path', ...args)
    })
    this._syncManager.on('new-tx', (...args) => {
      this.emit('new-tx', ...args)
    })
    return Promise.resolve(electrum)
  }

  _onNewTx() {
    return new Promise((resolve, reject) => {
      this.once('new-tx', () => resolve())
    })
  }

  async getNewAddress (config = {}) {
    let path = await this._hdWallet.getLastExtPath()
    const addrType = this._addressType
    const [hash, addr] = this.keyManager.pathToScriptHash(path, addrType)
    path = HdWallet.bumpIndex(path)
    await this._hdWallet.updateLastPath(path)
    await this._syncManager.watchAddress([hash, addr], 'ext')
    await this._hdWallet.addAddress(addr)
    return addr
  }

  async _getInternalAddress () {
    let path = await this._hdWallet.getLastIntPath()
    const addrType = this._addressType
    const [hash, addr] = this.keyManager.pathToScriptHash(path, addrType)
    path = HdWallet.bumpIndex(path)
    await this._hdWallet.updateLastPath(path)
    await this._syncManager.watchAddress([hash, addr], 'in')
    await this._hdWallet.addAddress(addr)
    return addr
  }

  getTransactions (opts) {
    return this._syncManager.getTransactions(opts)
  }

  getBalance (opts, addr) {
    return this._syncManager.getBalance(addr)
  }

  /**
  * Sync transactions
  * @param {Object} opts - Options
  * @param {Number} opts.restart - Restart sync from 0
  */
  async syncTransactions (opts = {}) {
    const { _syncManager } = this

    if (opts?.reset) {
      await _syncManager.reset()
    }

    await _syncManager.syncAccount(opts)
  }

  // Pause syncing transactions from electrum
  async pauseSync (opts) {
    return new Promise((resolve) => {
      if (!this._syncManager._isSyncing) return resolve()
      this._syncManager.once('sync-end', () => resolve())
      this._syncManager.stopSync()
    })
  }

  // @desc send transaction
  // @param {Object} opts - options
  // @param {Object} outgoing - transaction details
  // @param {String} outgoing.address - destination address
  // @param {String} outgoing.amount - amount to send
  // @param {String} outgoing.unit - unit of amount
  // @param {String} outgoing.fee - fee to pay in sat/vbyte. example: 10,
  sendTransaction (opts, outgoing) {
    let notify 
    const p = new Promise((resolve, reject) => {
      const tx = new Transaction({
        network: this.network,
        provider: this.provider,
        keyManager: this.keyManager,
        getInternalAddress: this._getInternalAddress.bind(this),
        syncManager: this._syncManager
      })
      
      tx.send(outgoing).then((sent)=>{
        if(notify) notify(sent)
        this._syncManager.watchTxMempool(sent.txid)
        this._syncManager.on('tx:mempool:'+sent.txid, () => {
          resolve(sent)
        })
      }).catch((err) => {
        reject(err)
      })
    })

    p.broadcasted  = (fn) => {
      notify = fn
    }
    return p
  }

  isValidAddress (opts, address) {
    return this._makeRequest('blockchain.address.get_balance', [address])
  }

  static parsePath (path) {
    return HdWallet.parsePath(path)
  }
}

module.exports = WalletPayBitcoin
