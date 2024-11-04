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
class MempoolSpace {
  constructor (config) {
    this.hostname = config.hostname || 'mempool.space'
    this.path = config.path || '/api/v1/fees/recommended'

    this._latest = null
    this._latest_t = Infinity
    this._http = config.http || require('https')
    this._fee_timer = config.fee_timer || 60000 // 1min
  }

  getEstimate () {
    return new Promise((resolve, reject) => {
      const { hostname, path } = this

      if (this._latest && (Date.now() - this._latest_t) < this._fee_timer) return resolve(this._latest)

      const options = {
        hostname,
        path,
        port: 443,
        method: 'GET',
        rejectUnauthorized: false,
        requestCert: true,
        agent: false
      }

      const req = this._http.request(options, (res) => {
        let data = ''

        res.on('data', (chunk) => {
          data += chunk
        })

        res.on('end', () => {
          try {
            data = JSON.parse(data)
          } catch (e) {
            return reject(e)
          }
          this._latest = data
          this._latest_t = Date.now()
          return resolve(data)
        })
      })
      req.end()
    })
  }
}
module.exports = MempoolSpace
