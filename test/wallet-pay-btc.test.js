const test = require('brittle')
const { 
  BitcoinPay,
  WalletStoreMemory,
  KeyManager,
  BIP39Seed,
  newElectrum,
  HdWallet,
  activeWallet
} = require('./test-helpers.js')

test("WalletPayBitcoin", function(t) {
  t.test('Create an instances of WalletPayBitcoin', async function(t) {
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

  t.test('getNewAddress', async function(t) {
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

    let addr3 = await btcPay2.getNewAddress()
    addr3 = BitcoinPay.parsePath(addr3.path)
    t.ok(lastIndex + 1 === addr3.index, 'index increased by 1, after recreating instances')
    await btcPay.destroy()
    await btcPay2.destroy()
  })

  t.test('syncTransactions ', async function(t) {
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
          btcPay.once('sync-end', () => {
            if(pass) return resolve()
            t.fail(`${sType} did not resume syncing`)
            resolve()
          })
          await btcPay.syncTransactions()
        }

        btcPay.on('synced-path', syncPause)
        await btcPay.syncTransactions(opts)
      })
    }

    await syncType('external',3, null)
    await syncType('internal', 5, { restart : true })
    await btcPay.destroy()
  })
  
  t.test('getBalance', async function(t) {
    t.test('compare to electrum server', async (t) => {
      const btcPay = await activeWallet()

      let total = 0
      btcPay.on('synced-path', async (pt, path) => {

        const [sc, addr] = btcPay.keyManager.pathToScriptHash(path, 'p2wpkh')
        const eBal = await btcPay.provider._getBalance(sc) 

        try {
          const bal = btcPay.getBalance(addr.address)
          t.ok(eBal.confirmed.toString() === bal.confirmed.toBaseUnit(), `addr: ${addr.address} confirmed matches electrum`) 
          t.ok(eBal.unconfirmed.toString() === bal.mempool.toBaseUnit(), `addr: ${addr.address} mempool matches electrum`) 
          total += +bal.confirmed.toMainUnit() + +bal.mempool.toMainUnit()
        } catch(err) {
          if(err.message.includes('Address not found')) return 
          throw err 

        }
      })

      await btcPay.syncTransactions()
      // console.log("Total wallet balance: ", total)
      await btcPay.destroy()

    })
  })
  
  t.test('bip84 test vectors', async function(t) {
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
    await btcPay.destroy()
  })

})


//test.test('sendTransaction', async function(t) {
//  t.test('sendBasic', async function(t) {
//    //TODO: 
//    return
//    const mnemonic = "sell clock better horn digital prevent image toward sort first voyage detail inner regular improve"
//    const btcPay = new BitcoinPay({
//      asset_name: 'btc',
//      provider: await newElectrum(),
//      key_manager: new KeyManager({
//        seed: await BIP39Seed.generate(mnemonic)
//      }),
//      store: new WalletStoreMemory(),
//      network: 'regtest'
//    })
//
//    await btcPay.initialize({})
//    const addr = await btcPay.getNewAddress()
//    const changeAddr = await btcPay._getInternalAddress()
//    await btcPay.syncTransactions()
//
//    await btcPay.sendTransaction({}, { address: "bc1qggnasd834t54yulsep6fta8lpjekv4zj6gv5rf", value: 10000 })
//  })
//})
