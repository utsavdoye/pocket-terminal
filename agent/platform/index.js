// Picks the power controls for this computer's operating system.
// Linux desktops and servers (no battery) run without the power brain: always awake, nothing to manage.
module.exports.supported = () => process.platform === 'darwin' || process.platform === 'win32'
  || (process.platform === 'linux' && require('./linux').hasBattery());
module.exports.sys = () => {
  if (process.platform === 'darwin') return require('./mac').sys;
  if (process.platform === 'win32') return require('./windows').sys;
  if (process.platform === 'linux') return require('./linux').sys;
  return {};
};
