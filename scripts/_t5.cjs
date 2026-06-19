const { readFileSync } = require("fs");
const env = readFileSync(".env","utf-8");
for (const line of env.split("\n")) { const m=line.match(/^APPROVAL_LINK_SECRET=(.+)$/); if(m) process.env.APPROVAL_LINK_SECRET=m[1].trim(); }
const crypto=require("crypto");
function sign(p){const enc=Buffer.from(JSON.stringify(p)).toString("base64url");const sig=crypto.createHmac("sha256",process.env.APPROVAL_LINK_SECRET).update(enc).digest("base64url");return enc+"."+sig;}
function hash(t){return crypto.createHash("sha256").update(t).digest("hex");}
const arg=process.argv[2], linkId=process.argv[3], collId=process.argv[4];
if(arg==="sign"){const t=sign({link_id:linkId,collection_id:collId,scope:{},exp:Date.now()+600000});console.log(JSON.stringify({token:t,hash:hash(t)}));}
