const bitcoin = require('bitcoinjs-lib')

class Transaction {
  constructor(config) {
    this.network = config.network
    this.provider = config.provider
    this.keyManager = config.key_manager
    this.db = config.db
    this._getInternalAddress = config.getInternalAddress
    this.utxos = config.utxos
  }

  send(opts) {
    const { addr, value, fee } = opts
    const tx = this._createTransaction(addr, value, fee)
    return this._broadcastTransaction(tx)
  }

  async _createTransaction(addr, value) {
    const { keyManager, provider, _getInternalAddress } = this
    const changeAddr = await _getInternalAddress()
    const psbt = new bitcoin.Psbt({ network: bitcoin.networks[this.network] })

    const outputValue =  +this.utxos[0].out[1].value.toBaseUnit()
    const txo = this.utxos[0]
    // fee calc: generate a fake tx to get size and then remake with fee
    // utxo selection:
    // find path of utxo 
    psbt.addInput({
      hash: this.utxos[0].txid,
      index: 1,
      witnessUtxo: {
        script: Buffer.from(txo.out[1].witness_hex, 'hex'),
        value:outputValue
      },
    })
    psbt.updateInput(0, {
      bip32Derivation: [
        {
          masterFingerprint: keyManager.bip32.fingerprint,
          path : txo.out[1].address_path,
          pubkey: Buffer.from(txo.out[1].address_public_key, 'hex')
        },
      ]})

    const satvbyte = 10
    const change = 560
    psbt.addOutput({
      address: 'bcrt1qknkl5l6aqwa9xmnse2zn0fppl9jd2jjpkc86yk',
      value: outputValue - change - (141 * satvbyte)
    })
    psbt.addOutput({
      address: "bcrt1qknkl5l6aqwa9xmnse2zn0fppl9jd2jjpkc86yk",
      value:  change
    })
    psbt.signInputHD(0, keyManager.bip32)
    psbt.finalizeAllInputs();
    const tx = psbt.extractTransaction()
    const satvbye = tx.virtualSize() 
    //console.log('satvbye')
    //console.log(satvbyte)
    //console.log(psbt.getFeeRate())
    //console.log(tx.virtualSize())
    console.log(tx.getId())
    console.log(tx.toHex())
  }
}

module.exports = Transaction;
