const fs = require('fs');
['_list.js','_build.js','_search.js','_cleanup.js'].forEach(f => {
  try { fs.unlinkSync(f); } catch(e) {}
});
console.log('cleaned');
