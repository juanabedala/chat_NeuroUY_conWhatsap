const extract = require('extract-zip');

(async () => {
  try {
    await extract('session.zip', { dir: __dirname });
    console.log('✅ Session descomprimida correctamente');
  } catch (err) {
    console.error('Error descomprimiendo session.zip:', err);
  }
})();
