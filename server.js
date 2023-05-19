const express = require('express')
const session = require('express-session')({
    secret: 'top_secret',
    resave: true,
    saveUninitialized: true,
})
const bodyParser = require('body-parser');
const url = require('url');

const axios = require('axios');

var qs = require('qs');

const app = express()

const SECONDS_PER_TOKEN = 60

console.log(process.env.PROJECT_DOMAIN)

var expressWs = require('express-ws')(app);

app.use(express.static('public'));
app.use(session);
app.set('view engine', 'pug');
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

app.get("/", (req, res) => {
  res.render('index', {
    title: 'Hey',
    message: 'Hello there!',
    chaster_login: (req.session.chaster_token || "").length != 0
  })
})

app.get("/profile", (req, res) => {
  res.render('profile', {
    title: 'Hey',
    message: 'Hello there!',
    token: req.access_token
  })
})

app.post("/connect_chaster", (req, res, next) => {
  console.log("post",req.body, req.query)
  var scopes = []
  
  Object.keys(req.body).map(function(key, index) {
     if(req.body[key]=="on"){
      scopes.push(key)
    }
  });
  
  
  res.redirect(`https://sso.chaster.app/auth/realms/app/protocol/openid-connect/auth?client_id=${process.env.CHASTER_CLIENT_ID}&response_type=code&redirect_uri=${encodeURI(`https://${process.env.PROJECT_DOMAIN}.glitch.me/chaster_callback`)}&scope=locks`)
})

app.get("/chaster_callback", async (req, res, next) => {
  console.log("/chaster_callback",req.body, req.query, req.params)
  const data = {
    grant_type: 'authorization_code',
    code: req.query.code,
    client_secret: process.env.CHASTER_CLIENT_SECRET,
    client_id: process.env.CHASTER_CLIENT_ID,
    redirect_uri: `https://${process.env.PROJECT_DOMAIN}.glitch.me/chaster_callback`
  }
  
  
  try{
    const token = await axios.post('https://sso.chaster.app/auth/realms/app/protocol/openid-connect/token', qs.stringify(data), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    }})
    req.session.chaster_token = token.data
    console.log(req.session.chaster_token)

    const locks = await axios.get('https://api.chaster.app/locks', {headers: {
      Authorization:`Bearer ${req.session.chaster_token.access_token}`,
      accept: 'application/json'
    }})
    req.session.chaster_locks = locks.data
    console.log(req.session.chaster_locks)
  }catch(e){
    console.log('eer', e)
  }
  res.redirect('/')
  
})

// express-ws
app.ws('/connect_chaturbate', async (ws, req) => {
  ws.on('message', function(msg) {
    ws.send(msg);
  });
  
  let url = req.query.eventToken
  
  try{
    while(true) {
      const events = await axios.get(url)
      url = events.data.nextUrl
      console.log(`Got ${(events.data.events || []).length} events!`)
      if( (events.data.events || []).length > 0 ) {
        console.log(events.data.events)
        events.data.events.forEach(e => {
          ws.send(JSON.stringify(e))
          if( (e.method || "") == "tip" ) {
            const duration = Math.floor(e.object.tip.tokens * SECONDS_PER_TOKEN)
            if( duration > 0 && (req.session.chaster_locks || []).length > 0) {
              req.session.chaster_locks.forEach(async (l) => {
                try{
                  await axios.post(`https://api.chaster.app/locks/${l["_id"]}/update-time`, { duration }, {headers: {
                    Authorization:`Bearer ${req.session.chaster_token.access_token}`,
                    accept: 'application/json',
                    "Content-Type": 'application/json'
                  }})
                }catch(e){
                  console.log('eer', e)
                  ws.send(JSON.stringify(e))
                }
              })
            }
          }
        })
      }
    }
  }catch(e){
    console.log('eer', e)
  }
  ws.close()
});

// listen for requests :)
const listener = app.listen(process.env.PORT, () => {
  console.log(`Your app is listening on port ${listener.address().port}`)
})