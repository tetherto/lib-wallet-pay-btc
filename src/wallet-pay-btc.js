const { WalletPay } = require('lib-wallet')
const Transaction = require('./transaction.js')
const HdWallet = require('./hdwallet.js')
const SyncManager = require('./sync-manager.js')
const Bitcoin = require('./currency')

const WalletPayError = Error

class SyncState {
  constructor (config = {}) {
    this.gap = config.gap || 0
    this.gapEnd = config.gapEnd || null
    this.path = config.path || null
  }
}

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

  async getSyncState (opts) {
    const state = await this.store.get('sync_state')
    if (!state || opts?.restart) {
      return this._newSyncState()
    }
    return state
  }

  _newSyncState () {
    return {
      internal: new SyncState(),
      external: new SyncState()
    }
  }

  async resetSyncState () {
    const state = this._newSyncState()
    await this.store.put('sync_state', state)
    return state
  }

  async setSyncState (state) {
    return this.store.put('sync_state', state)
  }

  async addWatchedScriptHashes (list, addrType) {
    return this.store.put('watched_script_hashes_' + addrType, list)
  }

  async getWatchedScriptHashes (addrType) {
    return await(this.store.get('watched_script_hashes_' + addrType)) || []
  }

  async setTotalBalance (balance) {
    return this.store.put('total_balance', balance)
  }

  async getTotalBalance () {
    return this.store.get('total_balance')
  }

}

class WalletPayBitcoin extends WalletPay {
  static networks = ['regtest', 'mainnet', 'testnet', 'signet', 'bitcoin']
  static events = ['ready', 'synced-path', 'new-tx']

  constructor (config) {
    config.provider = config.provider || (require('./electrum.js'))(config.electrum)
    super(config)
    if (!WalletPayBitcoin.networks.includes(this.network)) throw new WalletPayError('Invalid network')
    

    this.gapLimit = config.gapLimit || 20
    this.min_block_confirm = config.min_block_confirm || 1
    this.latest_block = 0 
    this.ready = false
    this.currency = Bitcoin
    this.keyManager = config.key_manager || null
  }

  async destroy () {
    await this.pauseSync()
    await this.provider.close()
    await this.state.store.close()
    await this._syncManager.close()
    await this._hdWallet.close()
    await this.keyManager.close()
    await this._postDestroy()
  }

  async initialize (wallet) {
    if (this.ready) return 
    await super.initialize(wallet)

    if(!this.keyManager) {
      this.keyManager = new (require('./wallet-key-btc.js'))({ seed: wallet.seed })
    }
    
    this._hdWallet = new HdWallet({ 
      store: this.store.newInstance({ name: 'hdwallet' }) 
    })
    this.state = new StateDb({
      store: this.store.newInstance({ name: 'state' })
    })
    this._syncManager = new SyncManager({
      state: this.state,
      gapLimit: this.gapLimit,
      hdWallet: this._hdWallet,
      utxoManager: this._utxoManager,
      provider: this.provider,
      keyManager: this.keyManager,
      currentBlock: this.latest_block,
      minBlockConfirm: this.min_block_confirm,
      store: this.store
    })


    await this.state.init()
    await this._syncManager.init()
    await this._hdWallet.init()
    const electrum = new Promise((resolve, reject) => {
      // @note: Blocks may be skipped.
      // TODO: handle reorgs
      this.provider.on('new-block', (block) => {
        this.latest_block = block.height
        this._syncManager.updateBlock(this.latest_block)
        this.ready = true
        this.emit('ready')
        resolve()
      })
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
    const addrType = HdWallet.getAddressType(path)
    const [hash, addr] = this.keyManager.pathToScriptHash(path, addrType)
    path = HdWallet.bumpIndex(path)
    await this._hdWallet.updateLastPath(path)
    await this._syncManager.watchAddress([hash, addr], 'ext')
    return addr
  }

  async _getInternalAddress () {
    let path = await this._hdWallet.getLastIntPath()
    const addrType = HdWallet.getAddressType(path)
    const [hash, addr] = this.keyManager.pathToScriptHash(path, addrType)
    path = HdWallet.bumpIndex(path)
    await this._hdWallet.updateLastPath(path)
    await this._syncManager.watchAddress([hash, addr], 'in')
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

    await _syncManager.syncAccount('external', opts)
    if (_syncManager.isStopped()) {
      _syncManager.resumeSync()
      return
    }
    await _syncManager.syncAccount('internal', opts)
    _syncManager.resumeSync()
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
  async sendTransaction (opts, outgoing) {
    const tx = new Transaction({
      network: this.network,
      provider: this.provider,
      keyManager: this.keyManager,
      getInternalAddress: this._getInternalAddress.bind(this),
      syncManager: this._syncManager
    })
    
    return tx.send(outgoing)
    
  }

  isValidAddress (opts, address) {
    return this._makeRequest('blockchain.address.get_balance', [address])
  }

  static parsePath (path) {
    return HdWallet.parsePath(path)
  }
}

module.exports = WalletPayBitcoin
