// Copyright 2024 Tether Operations Limited
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

'use strict'
const { EventEmitter } = require('events')
/**
 * Manages watching addresses for new transactions and changes.
 * @extends EventEmitter
 */
class AddressWatch extends EventEmitter {
  /**
   * Creates a new AddressWatch instance.
   * @param {Object} config - The configuration object.
   * @param {Object} config.state - The state management object.
   * @param {Object} config.provider - The provider for blockchain interactions.
   * @param {number} [config.maxScriptWatch=10] - Maximum number of script hashes to watch.
   */
  constructor (config) {
    super()
    this.state = config.state
    this.provider = config.provider
    this.maxScriptWatch = config.maxScriptWatch || 10
  }

  /**
   * Starts watching previously stored script hashes for changes.
   * @fires AddressWatch#new-tx
   * @throws {Error} If there's an issue subscribing to addresses.
   */
  async startWatching () {
    const { state, provider } = this
    const scriptHashes = (await state.getWatchedScriptHashes('in')).concat(
      await state.getWatchedScriptHashes('ext')
    )

    provider.on('new-tx', async (changeHash) => {
      this.emit('new-tx', changeHash)
    })

    try {
      await Promise.all(scriptHashes.map(async ([scripthash]) => {
        return provider.subscribeToAddress(scripthash)
      }))
    } catch (err) {
      console.log('failed to watch address', err)
    }
  }

  /**
   * Watches a new address by its script hash.
   * @param {string} scriptHash - The script hash of the address to watch.
   * @param {string} addrType - The type of address ('in' for internal or 'ext' for external).
   * @throws {Error} If there's an issue subscribing to the address.
   */
  async watchAddress (scriptHash, addrType) {
    const { state, maxScriptWatch, provider } = this
    const hashList = await state.getWatchedScriptHashes(addrType)
    if (hashList.length >= maxScriptWatch) {
      hashList.shift()
    }

    let balHash
    try {
      balHash = await provider.subscribeToAddress(scriptHash)
    } catch (err) {
      console.log('failed to subscribe to addr', err)
      return
    }

    if (balHash?.message) {
      throw new Error('Failed to subscribe to address ' + balHash.message)
    }
    hashList.push([scriptHash, balHash])
    await state.addWatchedScriptHashes(hashList, addrType)
  }

  /**
   * Retrieves the list of currently watched addresses.
   * @returns {Promise<{inlist: Array, extlist: Array}>} An object containing internal and external watched addresses.
   */
  async getWatchedAddress () {
    const inlist = await this.state.getWatchedScriptHashes('in')
    const extlist = await this.state.getWatchedScriptHashes('ext')
    return { inlist, extlist }
  }

  /**
  * @desc stop watching addresses
  **/
  async stopWatching (list) {
    return Promise.all(list.map((scripthash) => {
      return this.provider.unsubscribeFromAddress(scripthash)
    }))
  }
}

module.exports = AddressWatch
