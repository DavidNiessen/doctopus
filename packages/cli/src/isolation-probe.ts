import { readFile, statfs } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { toolVersion } from '@davidniessen/doctopus-contracts';

const [memory, cpu, pids, output] = process.argv.slice(2).map(Number);
const status = await readFile('/proc/self/status', 'utf8');
const mounts = await readFile('/proc/mounts', 'utf8');
const mounted = mounts.split('\n').map((line) => line.split(' '));
const sourceMount = mounted.find((fields) => fields[1] === '/work/project');
const outputMount = mounted.find(
  (fields) => fields[1] === '/work/project/.doctopus',
);
const temporaryMount = mounted.find((fields) => fields[1] === '/tmp');
const outputSpace = await statfs('/work/project/.doctopus');
if (
  !sourceMount?.[3]?.split(',').includes('ro') ||
  ![outputMount, temporaryMount].every(
    (mount) =>
      mount?.[2] === 'tmpfs' &&
      ['rw', 'nosuid', 'nodev', 'noexec'].every((flag) =>
        mount[3]?.split(',').includes(flag),
      ),
  ) ||
  outputSpace.bsize * outputSpace.blocks !== output
)
  throw new Error('Required isolated filesystem mounts are not enforced');
const read = async (name: string) =>
  (await readFile('/sys/fs/cgroup/' + name, 'utf8')).trim();
const memoryMax = await read('memory.max'),
  cpuMax = await read('cpu.max'),
  pidsMax = await read('pids.max');
const [quota, period] = cpuMax.split(' ').map(Number);
if (
  process.getuid?.() !== 1000 ||
  memoryMax !== String(memory) ||
  pidsMax !== String(pids) ||
  !period ||
  quota! / period !== cpu ||
  !/NoNewPrivs:\s+1/.test(status) ||
  !/Seccomp:\s+2/.test(status) ||
  !/CapEff:\s+0+\s/.test(status) ||
  Object.keys(networkInterfaces()).some((name) => name !== 'lo') ||
  !mounts.split('\n').some((line) => {
    const fields = line.split(' ');
    return fields[1] === '/' && fields[3]?.split(',').includes('ro');
  })
)
  throw new Error('Required isolated runtime controls are not enforced');
process.stdout.write(
  JSON.stringify({
    toolVersion,
    uid: 1000,
    memoryMax,
    cpuMax,
    pidsMax,
    outputBytes: output,
    network: 'none',
    readOnlyRoot: true,
    noNewPrivileges: true,
    seccomp: true,
    capabilities: 'none',
  }) + '\n',
);
