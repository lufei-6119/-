const http = require("http");
const os = require("os");
const { exec, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const port = 8080;
const mcDir = path.join(__dirname, "MinecraftServer");

if (!fs.existsSync(mcDir)) {
    fs.mkdirSync(mcDir);
}

let mcProcess = null;
let logs = [];

// 获取IP
function getLocalIP() {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === "IPv4" && !net.internal) {
                if (!net.address.startsWith("26.")) return net.address;
            }
        }
    }
    return "127.0.0.1";
}

// 本机信息
function getDiskInfo(callback) {
    exec("wmic logicaldisk get size,freespace,caption", (err, stdout) => {
        const lines = stdout.trim().split("\n").slice(1);
        const disks = lines.map(line => {
            const parts = line.trim().split(/\s+/);
            return {
                name: parts[0],
                size: parseInt(parts[2]),
                free: parseInt(parts[1]),
                used: parseInt(parts[2]) - parseInt(parts[1])
            };
        });
        callback(disks);
    });
}

let lastIdle = 0, lastTotal = 0;
function getCPUUsage() {
    const cpus = os.cpus();
    let idle = 0, total = 0;

    cpus.forEach(cpu => {
        for (let t in cpu.times) total += cpu.times[t];
        idle += cpu.times.idle;
    });

    const idleDiff = idle - lastIdle;
    const totalDiff = total - lastTotal;

    lastIdle = idle;
    lastTotal = total;

    return 100 - Math.round(100 * idleDiff / totalDiff);
}

// 防火墙
function getFirewallStatus(callback) {
    exec("netsh advfirewall show allprofiles", (err, stdout) => {
        callback(stdout.includes("ON") ? "开启" : "关闭");
    });
}

function getFirewallPorts(callback) {
    exec("netsh advfirewall firewall show rule name=all", (err, stdout) => {
        const ports = [];
        stdout.split("\n").forEach(line => {
            if (line.includes("LocalPort")) {
                const p = line.split(":")[1]?.trim();
                if (p && p !== "Any") ports.push(p);
            }
        });
        callback([...new Set(ports)]);
    });
}

// Minecraft
function startMC(command) {
    if (mcProcess) return;

    logs = [];

    mcProcess = spawn(command, {
        cwd: mcDir,
        shell: true
    });

    mcProcess.stdout.on("data", data => logs.push(data.toString()));
    mcProcess.stderr.on("data", data => logs.push(data.toString()));

    mcProcess.on("close", () => {
        logs.push("服务器已关闭");
        mcProcess = null;
    });
}

function sendCommand(cmd) {
    if (mcProcess) {
        mcProcess.stdin.write(cmd + "\n");
    }
}

const server = http.createServer((req, res) => {

    if (req.url === "/api/info") {
        getDiskInfo(disks => {
            res.end(JSON.stringify({
                cpu: os.cpus()[0].model,
                cpuUsage: getCPUUsage(),
                memTotal: os.totalmem(),
                memFree: os.freemem(),
                disks
            }));
        });
        return;
    }

    if (req.url === "/api/firewall") {
        getFirewallStatus(status => {
            getFirewallPorts(ports => {
                res.end(JSON.stringify({ status, ports }));
            });
        });
        return;
    }

    if (req.url === "/api/mc/logs") {
        res.end(JSON.stringify(logs.slice(-200)));
        return;
    }

    if (req.url.startsWith("/api/mc/start")) {
        let cmd = decodeURIComponent(req.url.split("?cmd=")[1] || "java -jar server.jar nogui");
        startMC(cmd);
        res.end("ok");
        return;
    }

    if (req.url === "/api/mc/stop") {
        sendCommand("stop");
        res.end("ok");
        return;
    }

    if (req.url.startsWith("/api/mc/cmd")) {
        let cmd = decodeURIComponent(req.url.split("?c=")[1]);
        sendCommand(cmd);
        res.end("ok");
        return;
    }

    if (req.url === "/api/mc/openfolder") {
        exec(`start "" "${mcDir}"`);
        res.end("ok");
        return;
    }

    if (req.method === "POST" && req.url === "/api/upload") {
        let filename = req.headers["x-filename"];
        let filePath = path.join(mcDir, filename);

        req.pipe(fs.createWriteStream(filePath));
        req.on("end", () => res.end("上传成功"));
        return;
    }

    

    fs.readFile("index.html", (err, data) => {
        res.writeHead(200, {"Content-Type":"text/html;charset=utf-8"});
        res.end(data);
    });
});

server.listen(port, () => {
    const ip = getLocalIP();
    console.log(`http://${ip}:${port}`);
    exec(`start http://${ip}:${port}`);
});