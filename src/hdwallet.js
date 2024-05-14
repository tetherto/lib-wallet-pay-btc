
const INIT_EXTERNAL_PATH = "m/84'/0'/0'/0/0"
const INIT_INTERNAL_PATH = "m/84'/0'/0'/1/0"

const ADDRESS_TYPES = {
  "84'": 'p2wpkh',
  "44'": 'p2pkh',
}

/**
  * @desc: Class to manage HD wallet paths
  * @link: https://github.com/bitcoin/bips/blob/master/bip-0084.mediawiki
  * @desc:  m / purpose' / coin_type' / account' / change / address_index
  */ 
class HdWallet {

  /**
  * @param: {Object} config
  * @param: {Object} config.store - store to save paths
  */
  constructor(config) {

    this.store = config.store
  }

  static INIT_EXTERNAL_PATH = INIT_EXTERNAL_PATH
  static INIT_INTERNAL_PATH = INIT_INTERNAL_PATH

  async init() {

    const currentPath = this.store.get('current_internal_path')
    if(!currentPath) {
      await this.store.put('current_internal_path', INIT_INTERNAL_PATH)
      await this.store.put('current_external_path', INIT_EXTERNAL_PATH)
      await this.store.put('addr_count', 0)
      await this.store.put('account_index', [this._formatAccountPath(INIT_EXTERNAL_PATH)])
    }
  }

  _formatAccountPath(path) {
    const parsed = HdWallet.parsePath(path)
    return [
      parsed.purpose, parsed.account
    ]
  }

  getAccountIndex() {
    return this.store.get('account_index')
  }

  getLastIntPath() {
    return this.store.get('current_internal_path')
  }

  getLastExtPath() {
    return this.store.get('current_external_path')
  }

  async _updateAddrCount() {
    const addrCount = await this.store.get('addr_count')
    this.store.put('addr_count', addrCount + 1)
  }

  async updatePath(path) {
    const parsed = HdWallet.parsePath(path)
    if(parsed.change) {
      return this.store.put('current_internal_path', path)
    }
    return this.store.put('current_external_path', path)
  }
  
  static setPurpose(path, value) {
    const parsed = HdWallet.parsePath(path)
    parsed.purpose = value
    return HdWallet.mergePath(parsed)
  }

  static setAccount(path, account) {
    const parsed = HdWallet.parsePath(path)
    parsed.account = account+(account.slice(-1) === "'" ? "" : "'")
    return HdWallet.mergePath(parsed)
  }

  static bumpAccount(path) {
    const parsed = HdWallet.parsePath(path)
    parsed.account = (Number.parseInt(parsed.account.split("'").shift()) + 1)+"'"
    return HdWallet.mergePath(parsed)
  }
  
  static setChangeIndex(path, index) {
    const parsed = HdWallet.parsePath(path)
    parsed.change = 1
    parsed.index = index
    return HdWallet.mergePath(parsed)
  }

  static bumpInternalIndex(path) {
    const parsed = HdWallet.parsePath(path)
    parsed.change = 1
    parsed.index += 1
    return HdWallet.mergePath(parsed)
  }

  static setChangeIndex(path, index) {
    const parsed = HdWallet.parsePath(path)
    parsed.change = 1
    parsed.index = index
    return HdWallet.mergePath(parsed)
  }

  static bumpExternalIndex(path) {
    const parsed = HdWallet.parsePath(path)
    parsed.change = 0 
    parsed.index += 1
    return HdWallet.mergePath(parsed)
  }

  static mergePath(path) {
    return `m/${path.purpose}/${path.coin_type}/${path.account}/${path.change}/${path.index}`
  }
  
  static parsePath(path) {
    const parts = path.split("/")
    if (parts.length !== 6) {
      throw new Error('Invalid HD path: '+path)
    }
    return {
      purpose: parts[1],
      coin_type: parts[2],
      account: parts[3],
      change: +parts[4],
      index: +parts[5]
    }
  }

  async _processPath(addrType, path, fn) {
    let next = true
    return new Promise(async (resolve, reject) => {
      const run = async () => {
        if(!next) return resolve()
        try {
          await fn(path, () => {
            next = false
          })
        } catch(e) {
          console.log(e)
          throw new Error('Failed to iterate through accounts '+ e)
        }
        path = this._bumpPathIndex(addrType, path)
        process.nextTick(run)
      }
      process.nextTick(run)
    })
  }

  _bumpPathIndex(addrType, path) {
    if(addrType === 'external') {
      return HdWallet.bumpExternalIndex(path)
    } 
    return HdWallet.bumpInternalIndex(path)
  }

  async eachAccount(addrType, state, fn) {

    const accounts = await this.getAccountIndex()
    let count = 0
    for(let account of accounts) {
      const [purpose, accountIndex] = account
      let path = addrType === 'external' ? INIT_EXTERNAL_PATH : INIT_INTERNAL_PATH
      if(!state) {
        path = HdWallet.setPurpose(path, purpose)
        path = HdWallet.setAccount(path, accountIndex)
      } else {
        path = this._bumpPathIndex(addrType, state)
      } 
      let next = true
      await this._processPath(addrType, path, fn)
    }
  }

  static getAddressType(path) {
    return ADDRESS_TYPES[HdWallet.parsePath(path).purpose]
  }
}

module.exports = HdWallet
