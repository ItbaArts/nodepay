const axios = require('axios');

class ProxyManager {
  constructor() {
    this.proxyUrls = [
      Buffer.from('aHR0cHM6Ly9pdGJhYXJ0cy5jb20vYWlyZHJvcC9wcm94eS9wcm94eTEudHh0', 'base64').toString()
    ];
    this.usedProxies = new Set();
  }

  async fetchNewProxies(count = 5) {
    try {
      const responses = await Promise.all(
        this.proxyUrls.map(url => axios.get(url))
      );
      
      const allProxies = responses
        .flatMap(response => response.data.split('\n'))
        .filter(line => line.trim())
        .map(line => {
          const match = line.match(/http:\/\/(.+):(.+)@(.+):(\d+)/);
          if (!match) return null;
          return {
            username: match[1],
            password: match[2],
            host: match[3],
            port: match[4]
          };
        })
        .filter(Boolean)
        .filter(proxy => !this.usedProxies.has(`${proxy.host}:${proxy.port}`));

      const selectedProxies = allProxies
        .sort(() => Math.random() - 0.5)
        .slice(0, count);

      selectedProxies.forEach(proxy => {
        this.usedProxies.add(`${proxy.host}:${proxy.port}`);
      });

      return selectedProxies;
    } catch (error) {
      console.log(`⚠️  ${'Gagal mengambil proxy baru:'.red} ${error.message}`.yellow);
      return [];
    }
  }

  clearUsedProxies() {
    this.usedProxies.clear();
  }
}

module.exports = ProxyManager; 