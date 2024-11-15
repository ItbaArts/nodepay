const axios = require('axios');
const crypto = require('crypto');
const ProxyManager = require('./ProxyManager');

class Bot {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.proxyManager = new ProxyManager();
    this.currentProxy = null;
    this.proxyFailCount = 0;
    this.maxProxyFails = 3;
    this.proxyChangeCount = 0;
    this.maxProxyChanges = 3;
    this.pingCount = 0;
    this.maxPingBeforeRest = 500;
    this.restDuration = 30 * 60 * 1000;
    this.randomizeInterval = true;
    this.baseInterval = this.config.retryInterval;
    this.lastPingTime = 0;
    this.minPingDelay = 3000;
    this.token = null;
    this.intervals = new Set();
    this.botId = Math.random().toString(36).substring(7);
    this.pingFailCount = 0;
    this.maxPingFails = 3;
  }

  getRandomInterval() {
    const variation = this.baseInterval * 0.3;
    return this.baseInterval + (Math.random() * variation * 2 - variation);
  }

  async connect(token, proxy = null) {
    this.currentProxy = proxy;
    this.token = token;
    
    try {
      const userAgents = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
      ];
      const userAgent = userAgents[Math.floor(Math.random() * userAgents.length)];
      
      const accountInfo = await this.getSession(token, userAgent, this.currentProxy);

      console.log(
        `✅ ${'Bot'.green} #${this.botId} ${'connected to session'.green} for UID: ${accountInfo.uid}`
      );
      this.logger.info('Session info', {
        uid: accountInfo.uid,
        name: accountInfo.name,
        useProxy: !!this.currentProxy,
      });

      console.log('');

      let nextPingTime = this.getRandomInterval();
      const interval = setInterval(async () => {
        try {
          const now = Date.now();
          const timeSinceLastPing = now - this.lastPingTime;
          
          if (timeSinceLastPing < this.minPingDelay) {
            return;
          }

          await this.sendPing(accountInfo, token, userAgent, this.currentProxy);
          this.lastPingTime = Date.now();
          
          if (this.randomizeInterval) {
            nextPingTime = this.getRandomInterval();
            this.clearIntervals();
            setTimeout(() => this.connect(token, this.currentProxy), nextPingTime);
          }
        } catch (error) {
          console.log(`❌ ${'Bot'.red} #${this.botId} ${'ping error'.red}: ${error.message}`);
          this.logger.error('Ping error', { botId: this.botId, error: error.message });
          this.handleProxyError();
        }
      }, nextPingTime);

      this.intervals.add(interval);

      if (this.sigintListener) {
        process.removeListener('SIGINT', this.sigintListener);
      }

      this.sigintListener = () => {
        this.clearIntervals();
        console.log(`\n👋 ${'Bot dihentikan'.green}`);
        process.exit(0);
      };

      process.on('SIGINT', this.sigintListener);

    } catch (error) {
      console.log(`❌ ${'Bot'.red} #${this.botId} ${'connection error'.red}: ${error.message}`);
      this.handleProxyError();
    }
  }

  clearIntervals() {
    for (const interval of this.intervals) {
      clearInterval(interval);
    }
    this.intervals.clear();
  }

  cleanup() {
    this.clearIntervals();
    if (this.sigintListener) {
      process.removeListener('SIGINT', this.sigintListener);
    }
  }

  async getSession(token, userAgent, proxy) {
    try {
      const config = {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'User-Agent': userAgent,
          Accept: 'application/json',
        },
      };

      if (proxy) {
        config.proxy = this.buildProxyConfig(proxy);
      }

      const response = await axios.post(this.config.sessionURL, {}, config);
      return response.data.data;
    } catch (error) {
      throw new Error('Session request failed');
    }
  }

  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getCurrentPingURL() {
    return this.config.pingURLs[this.config.currentPingURLIndex];
  }

  switchToNextPingURL() {
    this.config.currentPingURLIndex = (this.config.currentPingURLIndex + 1) % this.config.pingURLs.length;
    this.pingFailCount = 0;
    console.log(`\n🔄 ${'Beralih ke ping URL:'.yellow} ${this.getCurrentPingURL()}`);
  }

  async sendPing(accountInfo, token, userAgent, proxy) {
    const uid = accountInfo.uid || crypto.randomBytes(8).toString('hex');
    const browserId =
      accountInfo.browser_id || crypto.randomBytes(8).toString('hex');

    const pingData = {
      id: uid,
      browser_id: browserId,
      timestamp: Math.floor(Date.now() / 1000),
      version: '2.2.7',
    };

    try {
      const config = {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'User-Agent': userAgent,
          Accept: 'application/json',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Cache-Control': 'no-cache',
          'Sec-Ch-Ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
          'Sec-Ch-Ua-Mobile': '?0',
          'Sec-Ch-Ua-Platform': '"Windows"',
          'Sec-Fetch-Dest': 'empty',
          'Sec-Fetch-Mode': 'cors',
          'Sec-Fetch-Site': 'same-origin',
        },
      };

      if (proxy) {
        config.proxy = this.buildProxyConfig(proxy);
      }

      await axios.post(this.getCurrentPingURL(), pingData, config);
      this.pingCount++;
      this.pingFailCount = 0;
      console.log(`📡 ${'Bot'.cyan} #${this.botId} ${'ping sent'.cyan} for UID: ${uid} (${this.pingCount}/${this.maxPingBeforeRest})`);
      
      if (this.pingCount >= this.maxPingBeforeRest) {
        const restVariation = 10 * 60 * 1000;
        const actualRestDuration = this.restDuration + (Math.random() * restVariation * 2 - restVariation);
        
        console.log(`\n😴 ${'Bot akan istirahat sekitar'.yellow} ${Math.round(actualRestDuration/1000/60)} ${'menit'.yellow}`);
        this.logger.info('Bot entering rest period', { pingCount: this.pingCount });
        
        await this.sleep(actualRestDuration);
        
        this.pingCount = 0;
        this.proxyFailCount = 0;
        
        const newProxies = await this.proxyManager.fetchNewProxies(1);
        if (newProxies.length > 0) {
          const newProxy = newProxies[0];
          this.currentProxy = newProxy;
          console.log(`\n🔄 ${'Bot menggunakan proxy baru:'.green} ${newProxy.host}:${newProxy.port}`);
          this.logger.info('Bot using new proxy', { proxy: newProxy });
        } else {
          console.log(`\n⚠️ ${'Tidak dapat menemukan proxy baru, mencoba reset daftar proxy'.yellow}`);
          this.proxyManager.clearUsedProxies();
          const resetProxies = await this.proxyManager.fetchNewProxies(1);
          if (resetProxies.length > 0) {
            this.currentProxy = resetProxies[0];
          } else {
            console.log(`🛑 ${'Tidak ada proxy tersedia, bot dihentikan'.red}`);
            process.exit(1);
          }
        }

        console.log(`\n🔄 ${'Bot telah selesai istirahat dan akan melanjutkan operasi'.green}`);
        this.logger.info('Bot resuming after rest period');
        
        await this.getSession(token, userAgent, this.currentProxy);
      }

    } catch (error) {
      this.pingFailCount++;
      console.log(`⚠️ Ping error (${this.pingFailCount}/${this.maxPingFails})`);

      if (this.pingFailCount >= this.maxPingFails) {
        this.switchToNextPingURL();
        return this.sendPing(accountInfo, token, userAgent, proxy);
      }

      this.handleProxyError();
      throw new Error('Ping request failed');
    }
  }

  buildProxyConfig(proxy) {
    return proxy && proxy.host
      ? {
          host: proxy.host,
          port: parseInt(proxy.port),
          auth:
            proxy.username && proxy.password
              ? { username: proxy.username, password: proxy.password }
              : undefined,
        }
      : undefined;
  }

  async handleProxyError() {
    this.proxyFailCount++;
    console.log(`⚠️ Proxy error (${this.proxyFailCount}/${this.maxProxyFails})`);
    
    if (this.proxyFailCount >= this.maxProxyFails) {
      this.proxyFailCount = 0;
      this.proxyChangeCount++;
      
      if (this.proxyChangeCount >= this.maxProxyChanges) {
        this.cleanup();
        console.log(`🛑 ${'Bot dihentikan karena terlalu banyak pergantian proxy'.red}`);
        this.logger.error('Bot stopped due to excessive proxy changes');
        process.exit(1);
      }

      const newProxies = await this.proxyManager.fetchNewProxies(1);
      
      if (newProxies.length > 0) {
        const newProxy = newProxies[0];
        console.log(`\n🔄 ${'Mengganti ke proxy baru:'.yellow} ${newProxy.host}:${newProxy.port}`);
        this.currentProxy = newProxy;
        this.connect(this.token, newProxy);
      } else {
        console.log(`\n⚠️ ${'Tidak dapat menemukan proxy baru, mencoba reset daftar proxy'.yellow}`);
        this.proxyManager.clearUsedProxies();
        const resetProxies = await this.proxyManager.fetchNewProxies(1);
        if (resetProxies.length > 0) {
          this.currentProxy = resetProxies[0];
          this.connect(this.token, this.currentProxy);
        } else {
          console.log(`🛑 ${'Tidak ada proxy tersedia, bot dihentikan'.red}`);
          process.exit(1);
        }
      }
    }
  }
}

module.exports = Bot;
