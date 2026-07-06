// PM2 — mantém os WORKERS sempre no ar (reinicia sozinho se cair, sobe no boot).
// Uso:
//   npm i -g pm2
//   pm2 start ecosystem.config.cjs
//   pm2 logs cmd-workers       # acompanhar
//   pm2 save && pm2 startup    # sobreviver a reinício da máquina
//
// Em produção (VPS), troque "run dev" por "run start" (código já buildado).
module.exports = {
  apps: [
    {
      name: 'cmd-backend',
      cwd: './backend',
      script: 'npm',
      args: 'run start',
      autorestart: true,
      max_restarts: 100,
      restart_delay: 3000,
      max_memory_restart: '1G',
      time: true,
    },
    {
      name: 'cmd-workers',
      cwd: './workers',
      script: 'npm',
      args: 'run start',
      autorestart: true,        // reinicia se cair
      max_restarts: 100,
      restart_delay: 3000,      // espera 3s antes de reiniciar
      max_memory_restart: '1G', // reinicia se estourar memória
      time: true,
    },
  ],
};
