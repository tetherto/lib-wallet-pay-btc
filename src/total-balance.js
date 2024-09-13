'use strict'
const { Balance } = require('./address-manager.js')
/**
 * Manages the total balance for the wallet.
 */
class TotalBalance {
  /**
   * Creates a new BalanceManager instance.
   * @param {Object} config - The configuration object.
   * @param {Object} config.store - The storage interface for persisting balance data.
   */
  constructor (config) {
    this.state = config.state
    this.totalBalance = {
      in: new Balance(),
      out: new Balance(),
      fee: new Balance()
    }
  }

  /**
   * Initializes the BalanceManager by loading stored total balance.
   */
  async init () {
    try {
      const storedTotal = await this.state.getTotalBalance()
      if (storedTotal) {
        this.totalBalance = {
          in: new Balance(storedTotal.in.confirmed, storedTotal.in.pending, storedTotal.in.mempool),
          out: new Balance(storedTotal.out.confirmed, storedTotal.out.pending, storedTotal.out.mempool),
          fee: new Balance(storedTotal.fee.confirmed, storedTotal.fee.pending, storedTotal.fee.mempool)
        }
      }
    } catch (error) {
      console.error('Failed to initialize BalanceManager:', error)
      throw error
    }
  }

  /**
   * Updates the total balance.
   * @param {'in'|'out'} direction - Whether the transaction is incoming or outgoing.
   * @param {'confirmed'|'pending'|'mempool'} txState - The state of the transaction.
   * @param {Object} utxo -  utxo object
   * @param {String} point - utxo id
   * @param {number?} fee -  fee
   */
  async addTxId (direction, txState, utxo, point, fee) {
    this.totalBalance[direction].addTxid(txState, point, utxo.value)
    if (fee > 0) {
      this.totalBalance.fee.addBalance(txState, fee)
    }
    await this._persistBalance()
  }

  /**
   * Retrieves the total balance of the wallet.
   * @returns {Object} The total balance object.
   */
  getTotalBalance () {
    return this.totalBalance
  }

  /**
   * Calculates the spendable balance of the wallet.
   * @returns {number} The total spendable balance (confirmed + pending).
   */
  getSpendableBalance () {
    return this.totalBalance.out.combine(this.totalBalance.in)
  }

  /**
   * Resets the total balance to zero.
   */
  async resetBalance () {
    this.totalBalance = {
      in: new Balance(),
      out: new Balance(),
      fee: new Balance()
    }
    await this._persistBalance()
  }

  /**
   * Persists the current total balance state to storage.
   * @private
   */
  async _persistBalance () {
    return this.state.setTotalBalance()
  }
}

module.exports = TotalBalance