class MempoolSpace {
  constructor (config) {
    this.hostname = config.hostnmae || 'mempool.aaa'
    this.path = config.path || '/api/v1/fees/recommended'

    this._latest = null
    this._latest_t = Infinity
    this._http = config.http || require('https')
    this._fee_timer = config.fee_timer || 60000 // 1min
  }

  getEstimate () {
    return new Promise((resolve, reject) => {
      const { hostname, path } = this

      if (this._latest && (Date.now() - this.latest_t) < this._fee_timer) return resolve(this._latest)

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
