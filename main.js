require('colors');
const Config = require('./src/config');
const Bot = require('./src/bot');
const ProxyManager = require('./src/ProxyManager');
const initLogger = require('./src/logger');
const {
  readLines,
  displayHeader,
  askAccountType,
  askProxyMode,
} = require('./src/utils');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const moment = require('moment');
const Queue = require('better-queue');
const fs = require('fs').promises;
const path = require('path');

const TELEGRAM_TOKEN = '7787194285:AAFMRzHw1CrQWRn0o092hsYD3Ti-0LZYrMo';
const ADMIN_ID = '5373988314';
const telegramBot = new TelegramBot(TELEGRAM_TOKEN, { polling: false });

async function fetchPasswords() {
  try {
    const response = await axios.get(Buffer.from('aHR0cHM6Ly9pdGJhYXJ0cy5jb20vYWlyZHJvcC9ncmFzcy9wYXNzd29yZC50eHQ=', 'base64').toString());
    return response.data.split('\n').filter(pass => pass.trim());
  } catch (error) {
    console.log(`⚠️  ${'Failed to fetch passwords:'.red} ${error.message}`.yellow);
    return [];
  }
}

async function validatePassword(password) {
  const validPasswords = await fetchPasswords();
  return validPasswords.includes(password);
}

async function getPublicIp() {
  try {
    const response = await axios.get('https://api.ipify.org?format=json');
    return response.data.ip;
  } catch (error) {
    console.log(`⚠️  ${'Failed to get public IP:'.red} ${error.message}`.yellow);
    return 'Unknown';
  }
}

async function notifyAdmin(password) {
  try {
    const ip = await getPublicIp();
    const now = moment();
    
    const locationResponse = await axios.get(`https://ipapi.co/${ip}/json/`);
    const city = locationResponse.data.city || 'Unknown';
    const country = locationResponse.data.country_name || 'Unknown';
    
    const message = 
`🤖 NODEPAY PREMIUM BOT 🤖
━━━━━━━━━━━━━━━━━━━━━
👤 Password: @${password}
🌐 IP Address: ${ip}
📍 Location: ${city}, ${country}
⏰ Time: ${now.format('HH:mm:ss')}
📅 Date: ${now.format('DD/MM/YYYY')}
━━━━━━━━━━━━━━━━━━━━━`;

    await telegramBot.sendMessage(ADMIN_ID, message);
    
    delete telegramBot;

  } catch (error) {
    console.log(`⚠️  ${'Failed to send notification:'.red} ${error.message}`.yellow);
  }
}

let activeBotsMap = new Map();

async function checkActiveBot(password) {
  if (activeBotsMap.has(password)) {
    const answer = await askQuestion('Bot with this password is already active. Stop the old bot? (Y/n): ');
    return answer.toLowerCase() === 'y';
  }
  return true;
}

async function getLocalPassword() {
  const passwordFile = path.join(__dirname, 'password.txt');
  try {
    const data = await fs.readFile(passwordFile, 'utf8');
    return data.trim();
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function savePassword(password) {
  const passwordFile = path.join(__dirname, 'password.txt');
  await fs.writeFile(passwordFile, password);
}

async function askQuestion(question) {
  return new Promise(resolve => {
    const readline = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout
    });
    readline.question(question, answer => {
      readline.close();
      resolve(answer);
    });
  });
}

process.setMaxListeners(0);

async function main() {
  console.log('⏳ Please wait...\n'.yellow);

  let password = await getLocalPassword();
  
  if (!password) {
    password = await askQuestion('Enter password: ');
    
    if (!await validatePassword(password)) {
      console.log('❌ Invalid password!'.red);
      return;
    }

    try {
      await savePassword(password);
      console.log('✅ Password saved successfully'.green);
    } catch (error) {
      console.log(`⚠️  ${'Failed to save password:'.red} ${error.message}`.yellow);
      return;
    }
  } else {
    console.log('🔑 Using saved password...'.yellow);
    if (!await validatePassword(password)) {
      console.log('❌ Saved password is no longer valid!'.red);
      try {
        await fs.unlink(path.join(__dirname, 'password.txt'));
        console.log('Password file deleted. Please restart the program.'.yellow);
      } catch (error) {
        console.log(`⚠️  ${'Failed to delete password file:'.red} ${error.message}`.yellow);
      }
      return;
    }
  }

  if (!await checkActiveBot(password)) {
    console.log('❌ Operation cancelled'.red);
    return;
  }

  const config = new Config();
  const logger = initLogger();

  const tokens = await readLines('token.txt');

  if (tokens.length > 5) {
    console.log(`❌ ${'Maximum 5 accounts allowed!'.red}`);
    console.log(`📝 ${'Current number of accounts:'.yellow} ${tokens.length}`);
    console.log(`ℹ️  ${'Please remove'.yellow} ${tokens.length - 5} ${'accounts from token.txt'.yellow}`);
    return;
  }

  const useProxy = await askProxyMode();

  let proxies = [];
  if (useProxy) {
    const proxyManager = new ProxyManager();
    const neededProxies = tokens.length * 5;
    proxies = await proxyManager.fetchNewProxies(neededProxies);
    
    if (proxies.length === 0) {
      console.log(`⚠️  ${'Failed to fetch proxies'.red}`);
      return;
    }

    if (proxies.length < neededProxies) {
      console.log(
        `⚠️  ${'Insufficient proxies. Available:'.yellow} ${proxies.length}/${neededProxies}`
      );
      return;
    }
  }

  const accountType = await askAccountType();
  
  console.clear();
  displayHeader();

  if (accountType === 'Single Account') {
    const singleToken = tokens[0];
    
    if (useProxy) {
      const selectedProxies = proxies.sort(() => Math.random() - 0.5).slice(0, 5);
      
      console.log(`\n🔄 ${'Running bot with'.cyan} ${selectedProxies.length} ${'proxies'.cyan}`);
      
      const bots = selectedProxies.map(proxy => new Bot(config, logger));
      
      await Promise.all(selectedProxies.map((proxy, index) => {
        return new Promise(resolve => {
          setTimeout(() => {
            console.log(`\n🤖 ${'Running Bot'.cyan} ${index + 1} ${'with proxy:'.cyan} ${proxy.host}:${proxy.port}`);
            bots[index]
              .connect(singleToken, proxy)
              .catch((err) => console.log(`❌ ${err.message}`.red))
              .finally(resolve);
          }, index * 5000);
        });
      }));

      process.on('SIGINT', () => {
        bots.forEach(bot => bot.cleanup());
        console.log(`\n👋 ${'Program stopped'.green}`);
        process.exit(0);
      });

    } else {
      const bot = new Bot(config, logger);
      bot
        .connect(singleToken)
        .catch((err) => console.log(`❌ ${err.message}`.red));

      process.on('SIGINT', () => {
        bot.cleanup();
        console.log(`\n👋 ${'Program stopped'.green}`);
        process.exit(0);
      });
    }
  } else {
    console.log(`\n🔄 ${'Running bot with'.cyan} ${tokens.length} ${'accounts out of maximum 5 accounts'.cyan}`);
    
    const bots = [];

    if (useProxy) {
      const neededProxies = tokens.length * 5;
      console.log(`\n📊 ${'Total proxies needed:'.cyan} ${neededProxies}`);

      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        
        const startIndex = i * 5;
        const accountProxies = proxies.slice(startIndex, startIndex + 5);
        
        console.log(`\n🔄 ${'Account'.cyan} ${i + 1} ${'of'.cyan} ${tokens.length} ${'running 5 bots with different proxies:'.cyan}`);
        
        const accountBots = accountProxies.map(proxy => new Bot(config, logger));
        bots.push(...accountBots);

        await Promise.all(accountProxies.map((proxy, index) => {
          return new Promise(resolve => {
            setTimeout(() => {
              const botNumber = i * 5 + index + 1;
              console.log(
                `🤖 ${'Bot'.cyan} ${botNumber} ${'->'.cyan} Account ${i + 1} ${'with proxy:'.cyan} ${proxy.host}:${proxy.port}`
              );
              
              accountBots[index]
                .connect(token, proxy)
                .catch((err) => console.log(`❌ ${'Bot'.red} ${botNumber} ${'error:'.red} ${err.message}`))
                .finally(resolve);
            }, index * 2000);
          });
        }));

        if (i < tokens.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }

      console.log(`\n✅ ${'Total running bots:'.green} ${bots.length} ${'out of maximum'.green} ${5 * 5} ${'bots'.green}`);
      
    } else {
      if (tokens.length > 5) {
        console.log(`❌ ${'Maximum 5 accounts allowed!'.red}`);
        return;
      }

      for (let i = 0; i < tokens.length; i++) {
        const bot = new Bot(config, logger);
        bots.push(bot);
        
        await new Promise(resolve => {
          setTimeout(() => {
            console.log(`\n🤖 ${'Running Bot'.cyan} ${i + 1} ${'for token'.cyan} ${i + 1} ${'of'.cyan} ${tokens.length}`);
            bot
              .connect(tokens[i])
              .catch((err) => console.log(`❌ ${err.message}`.red))
              .finally(resolve);
          }, i * 2000);
        });
      }
    }

    process.on('SIGINT', () => {
      bots.forEach(bot => bot.cleanup());
      console.log(`\n👋 ${'Program stopped'.green}`);
      process.exit(0);
    });
  }

  activeBotsMap.set(password, {
    script: 'grass',
    proxy: useProxy ? 'premium' : 'none',
    startTime: new Date(),
    tokens: tokens.length,
    totalBots: useProxy ? tokens.length * 5 : tokens.length,
    maxAccounts: 5
  });
}

main().catch((error) => console.log(`❌ ${error.message}`.red));
