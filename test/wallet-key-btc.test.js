const test = require('brittle')
const assert = require('assert')
const Key = require('../src/wallet-key-btc')
const Bip39Seed = require('wallet-seed-bip39')

const phrase = 'case maple example runway derive original nose office sunset end daring valve'
const paths = [
["m/84'/0'/0'/0/0", "bc1qxls0r5fpxa5chl6jxjsnnz4wf9564eywxye3vf", "02b8ef819e37d06edb956579662e9393aa69f7266760b50f04e40699897c3365ef", "L3rE8R4Z5j1QJzTb6ysMyFfBocmk8ap1a3pQhWopYG3mFSiLyMTM"],
["m/84'/0'/0'/0/1", "bc1q7hxsmf3w5684hfe2q2vrxvpwya5zagdsyshpf7", "02a1a9e05bbb34abd98dbca5a7924d9855a363b41fcdb22772a416b36a599a7b32", 	"KzDcNPXHNVRoXc7rVzDK7ezsVFt75xdx3WaFEw5TRTKq5KxAHdMn"],
["m/84'/0'/0'/0/2", "bc1qgs800u8nm4ptm0f2n6wpm096wnld4lc85pprmd", "03d38c14f48db51e057ccbdf88935ee5f683054958aec401521f6e89196f626746", 	"KyGz5SAx5THrm2FS2qQvnCKzpKNnHDHmjGNYUHSU4doV19oNGsEB"],
["m/84'/0'/0'/0/3", "bc1qcgr7n260530nledvhjmvye7hqzf8jr2nrw8atj", "0212e8062c4890611d9dec7367cda575756ee2c6f02de1774a143b365d60cc579f", 	"L2jzp4VH6bfRzEyNnqkiGSPyG8x9bFwpntN9AhVDgKvoV1QNfdZQ"],
["m/84'/0'/0'/0/4", "bc1qdrmdn7zmcel4k0yqq9cp7wc760pdkx26mmmepa", "02e39c1f21dbd8964193808662a0091fe3ac373e690861cbe5b2fb666b2ab53319", 	"L3sJPtfn8tdKDeoCgLybWVczhaMxHLkSwHBJk3YR5Yfut5ign5LG"],
["m/84'/0'/0'/0/5", "bc1qdwgnag9hz9zyhu4ud4pc6l7wmjd84r7u4mpndj", "02130cd42c27c8a2dc3ea25d0752fef43c62fbd415733ba6e6d422d9ff07f4b12b", 	"KwVetQuo3xgUr1aPrP1fG2uQfmttHDKzETeZMKwKbd2dbQ64psZC"],
["m/84'/0'/0'/0/6", "bc1qga4qqw6tusuarr66hgjssw5ndwhpp55qr6atuq", "039bc611cd3878dee844915c5f7fd436cf9030c4424c33032385990e2a9e0ce3da", 	"L4uUCzs1hf5MUAHDPU26DJzToyvyE46LavZE8CKWUESp9fvF9pzN"],
["m/84'/0'/0'/0/7", "bc1qpsjecadugklu22anuudv6g55msjp82ts35yfw2", "02bfec9b82e12d5221da8f796affa634dc3dd22c5b8574eabed2ee7c6f27afa61f", 	"L4cbJyfnseJsyqXWBsbwpHGy1nRxUxzvt32mK4N75tzpURuEKK9s"],
["m/84'/0'/0'/0/8", "bc1q2ced563tehq2f7jq8ccfkdyufvqxn7660yzesc", "0225c896502075e41eeaaea7b804fe4bae88bdb6cef271ae987882aef0fc435c15", 	"KybMjJfN6mjuTz4rVcGjrKce62TV5vgzp1USZcfQVuU5zxtwnx8u"],
["m/84'/0'/0'/0/9", "bc1q3krt6p057aqr46wxe4d25jfmzl03rpx92zrkqf", "028b56e7dfacf19b5646fca4f28b75533a4b81516d64168a246fc5307f203b5618", 	"Kwz3WAh8qnQ6iDe9R2BRsFJe1joHmS7khswfnEAF7oijSmyiE3qE"]
]

test('Create Bitcoin key instance', async (t) => {
  const seed = await Bip39Seed.generate()
  const k = new Key({
    seed
  })
  t.ok(k.seed.mnemonic === seed.mnemonic, 'mnemonic matches')
  t.ok(k.ready, 'is ready')
})

test('AddrFromPath for BIP84 p2wpkh', async (t) => {
  const seed = await Bip39Seed.generate(phrase)
  const k = new Key({
    seed
  })
  paths.forEach(([path, addr, pk, wif]) => {
    const res  = k.addrFromPath(path, 'p2wpkh')
    t.ok(res.address === addr, 'Address matches ' + path)
    t.ok(res.publicKey === pk, 'pub key matches '  + path)
    t.ok(res.publicKey === pk, 'pub key matches '  + path)
    t.ok(res.WIF === wif, 'wif  matches ' + path)
  })
})
