const fs = require('fs');
const readline = require('readline');
const inquirer = require('inquirer');
const axios = require('axios');

async function readLines(filename) {
  const fileStream = fs.createReadStream(filename);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });
  const lines = [];
  for await (const line of rl) lines.push(line.trim());
  return lines;
}

async function displayHeader() {
  process.stdout.write('\x1Bc');
  try {
    const response = await axios.get('http://itbaarts.com/api_prem.json');
    console.log(response.data.cyan);
    console.log();
  } catch (error) {
    console.error('Error fetching header:', error.message);
    console.log('Failed to fetch header text');
    console.log();
  }
}

async function askAccountType() {
  const answers = await inquirer.prompt([
    {
      type: 'list',
      name: 'accountType',
      message: 'How many accounts would you like to use?',
      choices: ['Single Account', 'Multiple Accounts'],
    },
  ]);

  console.log('');

  return answers.accountType;
}

async function askProxyMode() {
  const answers = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'useProxy',
      message: 'Would you like to use proxies?',
      default: true,
    },
  ]);

  console.log('');

  return answers.useProxy;
}

module.exports = { readLines, displayHeader, askAccountType, askProxyMode };
