const { solo, test } = require('brittle')
const { 
  BitcoinPay,
  WalletStoreMemory,
  KeyManager,
  BIP39Seed,
  newElectrum,
  HdWallet,
  activeWallet,
  regtestNode, 
  pause,
  BitcoinCurrency
} = require('./test-helpers.js')

test.configure({ timeout: 600000 })

test('Create an instances of WalletPayBitcoin', async function(t) {
  const btcPay = new BitcoinPay({
    asset_name: 'btc',
    provider: await newElectrum(),
    key_manager: new KeyManager({
      seed: await BIP39Seed.generate()
    }),
    store: new WalletStoreMemory(),
    network: 'regtest'
  })
  await btcPay.initialize({})
  await btcPay.destroy()

})

test('getNewAddress no duplicate addresses, after recreation', async function(t) {

  const store = new WalletStoreMemory()
  const seed =  await BIP39Seed.generate()
  const btcPay = new BitcoinPay({
    asset_name: 'btc',
    provider: await newElectrum(),
    key_manager: new KeyManager({
      seed
    }),
    store,
    network: 'regtest'
  })
  await btcPay.initialize({})



  const addr1 = await btcPay.getNewAddress()
  const addr2 = await btcPay.getNewAddress()
  t.ok(addr1.address !== addr2.address, '2 address should not match')
  t.ok(addr1.path !== addr2.path, '2 addr path should not match')
  const path1 = BitcoinPay.parsePath(addr1.path)
  const path2 = BitcoinPay.parsePath(addr2.path)
  const addrIndex = btcPay.latest_addr
  t.ok((path2.index - path1.index) == 1, 'index increased by 1')
  const lastIndex = path2.index

  const btcPay2 = new BitcoinPay({
    asset_name: 'btc',
    provider: await newElectrum(),
    key_manager: new KeyManager({
      seed
    }),
    store,
    network: 'regtest'
  })
  await btcPay2.initialize({})
  const lastExt2 = await btcPay._hdWallet.getLastExtPath()

  let addr3 = await btcPay2.getNewAddress()
  addr3 = BitcoinPay.parsePath(addr3.path)
  t.ok(lastIndex + 1 === addr3.index, 'hd path index increased by 1, after recreating instances')

  await btcPay.destroy()
  await btcPay2.destroy()
})

test('getNewAddress - address reuse logic', async (t) => {

  // Generate an new wallet and send some bitcoin to the address
  // generate wallet with same seed, resync and make sure that the address is not reused

  const regtest = await regtestNode()
  const seed =  await BIP39Seed.generate()
  const btcPay = new BitcoinPay({
    asset_name: 'btc',
    provider: await newElectrum(),
    key_manager: new KeyManager({
      seed
    }),
    store : new WalletStoreMemory(),
    network: 'regtest'
  })
  await btcPay.initialize({})
  const lastExt = await btcPay._hdWallet.getLastExtPath()
  t.ok(lastExt === HdWallet.INIT_EXTERNAL_PATH, 'first instance last external path is the default path when created')
  const addr = await btcPay.getNewAddress()
  const amount = 0.0001
  const a = await regtest.sendToAddress({ address : addr.address, amount })
  await pause(10000)
  await regtest.mine(2)

  let _pathBalanceChecked = false
  btcPay.once('synced-path', async (pt, path, hasTx) => { 
    t.ok(path === addr.path, 'synced path matches address path')
    t.ok(hasTx, 'address has balance')
    _pathBalanceChecked = true
  })

  await btcPay.syncTransactions()

  if(!_pathBalanceChecked) t.fail('path balance not checked') 


  const btcPay2 = new BitcoinPay({
    asset_name: 'btc',
    provider: await newElectrum(),
    key_manager: new KeyManager({
      seed
    }),
    store : new WalletStoreMemory(),
    network: 'regtest'
  })
  await btcPay2.initialize({})
  const lastExt2 = await btcPay2._hdWallet.getLastExtPath()
  t.ok(lastExt2 === HdWallet.INIT_EXTERNAL_PATH, 'second instance last path is the default path when created')
  _pathBalanceChecked = true
  btcPay2.once('synced-path', async (pt, path, hasTx) => { 
    t.ok(path === addr.path, 'second instance synced path matches address path')
    t.ok(hasTx, 'second instance address has transactions')
    _pathBalanceChecked = true
  })
  await btcPay2.syncTransactions()
  const addr2  = await btcPay2.getNewAddress()

  const parsed = BitcoinPay.parsePath(addr.path)
  const parsed2 = BitcoinPay.parsePath(addr2.path)
  // Checking that address is not reused when it's already paid
  t.ok(addr.address !== addr2.address, 'address is not reused')
  t.ok(parsed.index + 1 === parsed2.index, 'index increased by 1')
  t.ok(parsed2.change === parsed.change, 'address type is same')

  await btcPay.destroy()
  await btcPay2.destroy()
})

test('watch addresses', function(t) {

  test('create address, send btc and check balance', async function(t) {
    return new Promise(async (resolve, reject) => { 
      const regtest = await regtestNode()
      const btcPay = await activeWallet({ newWallet: true  })
      const max = btcPay._syncManager._max_script_watch

      async function newTx(amount, addr, i) {
        const balance = await btcPay.getBalance({}, addr.address)
        const bal = balance.pending.add(balance.confirmed).toMainUnit()
        t.ok(bal === amount.toString(), `address balance matches sent amount ${addr.address} - ${amount} - ${bal}`)
        if(i === max-1) {
          // TODO: CHECK SIZE OF ADDRESS BEING TRACKED
          //t.ok(btcPay._syncManager._addr.size === btcPay._syncManager._max_script_watch, 'address being tracked is correct')
          await btcPay.destroy()
          resolve()
        }
      }

      for(let i = 0; i < max; i++) {
        const addr = await btcPay.getNewAddress()
        const amount = +(Math.random() * 0.01).toFixed(5)
        const a = await regtest.sendToAddress({ address : addr.address, amount })
        console.log('sending: ', amount, ' to address: ', addr.address)
        btcPay.once('new-tx', newTx.bind(this, amount, addr, i))
        const mine = await regtest.mine(1)
      }
    })
  })

})

solo('getTransactions', (t) => {
  return new Promise(async (resolve, reject) => { 
    const regtest = await regtestNode()
    const btcPay = await activeWallet()

    await btcPay.syncTransactions()

    let last = 0
    await btcPay.getTransactions((tx) => {
      const h = tx[0].height
      if(!last) {
        last = h
        return 
      }
      t.ok(last < h, 'tx height is in descending order height: '+h)
      last = h
    })

    await btcPay.destroy()
    resolve()
  })

})

test('syncTransactions ', async function(t) {
  const btcPay = await activeWallet()

  async function syncType(sType, pauseCount, opts) {
    return new Promise(async (resolve, reject) => {

      let pathState
      let count = 0

      // Handle pausing syncing
      let lastPath = { external : [], internal : [] }
      let syncPause = async (pathType, path, hasTx, [gapCount, gapLimit, gapEnd]) => {
        if(pathType !== sType) return
        let pp = BitcoinPay.parsePath(path)
        lastPath[pathType].push(pp.index)
        if(lastPath[pathType].length > 1) {
          const lp = lastPath[pathType][lastPath[pathType].length-2]
          t.ok(lp - pp.index === -1, `Path index ${pathType} - `+ path) 
        }
        if(opts?.restart && count === 0) {
          t.ok(gapCount === 0, 'gap count is 0, when restarting')
        }
        if(count !== pauseCount ) {
          count ++ 
          return 
        }

        pathState = path

        // Pause sync
        btcPay.off('synced-path', syncPause)
        await btcPay.pauseSync()
        t.ok(!btcPay._syncState, sType+ ' sync is paused')
        resumeSync()
      }

      let resumeSync = async () => {
        let pass = false 
        const resumeHandler = async (pt, path) => {
          if(pt !== sType) return
          const lastPath = BitcoinPay.parsePath(pathState)
          const currentPath = BitcoinPay.parsePath(path)
          // Check that the path is resumed from where we left off.
          t.ok(lastPath.purpose === currentPath.purpose, sType + ' resume sync: purpose')
          t.ok(lastPath.coin_type === currentPath.coin_type, sType + ' resume sync: coin_type')
          t.ok(lastPath.account === currentPath.account, sType +  ' resume sync: account')
          t.ok(lastPath.change === currentPath.change, sType +  ' resume sync: change')
          t.ok(lastPath.index - currentPath.index === -1, sType +  ' resume sync: index increased by 1')
          pass = true
          btcPay.off('synced-path', resumeHandler)
        }
        btcPay.on('synced-path', resumeHandler)
        await btcPay.syncTransactions()
        if(pass) return resolve()
        t.fail(`${sType} did not resume syncing`)
        resolve()
      }

      btcPay.on('synced-path', syncPause)
      await btcPay.syncTransactions(opts)
    })
  }

  await syncType('external',3, null)
  await syncType('internal', 5, { restart : true })
  await btcPay.destroy()
})


test('getBalance', (t) => {
  return new Promise(async (resolve, reject) => {

    const regtest = await regtestNode()
    const btcPay = await activeWallet()

    let total = 0
    let payAddr
    async function checkBal(pt, path, hasTx, gapCount) {
      const [sc, addr] = btcPay.keyManager.pathToScriptHash(path, 'p2wpkh')
      const eBal = await btcPay.provider._getBalance(sc) 

      try {
        const bal = btcPay.getBalance({}, addr.address)
        const balTotal = bal.confirmed.add(bal.pending).toBaseUnit()
        t.ok(eBal.confirmed.toString() === balTotal, `addr: ${addr.address} confirmed matches electrum ${eBal.confirmed} - ${balTotal}`) 
        t.ok(eBal.unconfirmed.toString() === bal.mempool.toBaseUnit(), `addr: ${addr.address} mempool matches electrum`) 
        total += +bal.confirmed.toMainUnit() + +bal.mempool.toMainUnit()
        if(addr.address === payAddr?.address) {
          t.ok(new BitcoinCurrency(eBal.confirmed, 'base').eq(new BitcoinCurrency(amount, 'main')), 'amount matches sent amount')
          btcPay.off('synced-path', checkBal)
          resolve()
        }
      } catch(err) {
        if(err.message.includes('Address not valid')) return err
        throw err 
      }

    }
   
    btcPay.on('synced-path', checkBal)
    await btcPay.syncTransactions()
    btcPay.off('synced-path', checkBal)
    // Send some bitcoin to the address and check if the amounts match 
    payAddr = await btcPay.getNewAddress()
    const amount = 0.0888
    const a = await regtest.sendToAddress({ address : payAddr.address, amount })
    await regtest.mine(2)
    await pause(10000)
    btcPay.on('synced-path', checkBal)
    await btcPay.syncTransactions({ reset : true })
    await btcPay.destroy()
  })
})


test('bip84 test vectors', async function(t) {
  // LINK: https://github.com/bitcoin/bips/blob/master/bip-0084.mediawiki
  const mnemonic = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
  const btcPay = new BitcoinPay({
    asset_name: 'btc',
    provider: await newElectrum(),
    key_manager: new KeyManager({
      seed: await BIP39Seed.generate(mnemonic)
    }),
    store: new WalletStoreMemory(),
    network: 'bitcoin'
  })
  await btcPay.initialize({})

  const addr1 = await btcPay.getNewAddress()
  const addr2 = await btcPay.getNewAddress()
  const changeAddr = await btcPay._getInternalAddress()
  const changeAddr2 = await btcPay._getInternalAddress()

  t.ok(addr1.address === 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu', 'fiirst receive address')
  t.ok(addr1.path === "m/84'/0'/0'/0/0", 'first receive path')
  t.ok(addr1.WIF === 'KyZpNDKnfs94vbrwhJneDi77V6jF64PWPF8x5cdJb8ifgg2DUc9d', 'first receive WIF')
  t.ok(addr1.publicKey === '0330d54fd0dd420a6e5f8d3624f5f3482cae350f79d5f0753bf5beef9c2d91af3c', 'first receive public key')
  
  t.ok(addr2.address === 'bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g', 'second recieve address')
  t.ok(addr2.path === "m/84'/0'/0'/0/1", 'second receive path')
  t.ok(addr2.WIF === 'Kxpf5b8p3qX56DKEe5NqWbNUP9MnqoRFzZwHRtsFqhzuvUJsYZCy', 'second receive WIF')

  
  t.ok(changeAddr.address === 'bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el', 'First change address')
  t.ok(changeAddr.path === "m/84'/0'/0'/1/0", 'first change path')
  
  t.ok(changeAddr2.path === "m/84'/0'/0'/1/1", 'second change path')
  t.ok(changeAddr2.address === 'bc1qggnasd834t54yulsep6fta8lpjekv4zj6gv5rf', 'second change address')

  const bp = new BitcoinPay({
    asset_name: 'btc',
    provider: await newElectrum(),
    key_manager: new KeyManager({
      seed: await BIP39Seed.generate()
    }),
    store: new WalletStoreMemory(),
    network: 'bitcoin'
  })
  await bp.initialize({})
  const bpAddr = await bp.getNewAddress()
  for(key in addr1) {
    const bVal = bpAddr[key]
    const aVal = addr1[key]
    if(key === 'path') {
      t.ok(bVal === aVal, `generate same ${key} with different mnemonic`)
      continue
    }
    t.ok(bVal !== aVal, `generate different ${key} with different mnemonic`)
  }
  await btcPay.destroy()
  await bp.destroy()
})


