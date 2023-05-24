const express = require("express");
const session = require("express-session")({
  secret: "top_secret",
  resave: true,
  saveUninitialized: true,
});
const bodyParser = require("body-parser");
const url = require("url");
const handlebars = require("express-handlebars");

const axios = require("axios");

var qs = require("qs");

const app = express();

console.log(process.env.PROJECT_DOMAIN);

var expressWs = require("express-ws")(app);

app.use(express.static("public"));
app.use(session);

app.set("view engine", "hbs");
app.engine(
  "hbs",
  handlebars.engine({
    layoutsDir: __dirname + "/views/layouts",
    extname: ".hbs",
    defaultLayout: "index",
  })
);

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

function getDuration(tokens) {
  if (tokens >= 500) {
    return 60 * 60 * 24 * 2;
  } else if (tokens >= 250) {
    return 60 * 60 * 24;
  } else if (tokens >= 100) {
    return 60 * 60 * 8;
  } else if (tokens >= 75) {
    return 60 * 60 * 4;
  } else if (tokens >= 35) {
    return 60 * 60;
  }
  // Optionally do minute per token
  return tokens * 60;

  return 0;
}

function needTokenRefresh(session) {
  return true; //(session.chaster_token.ttime + session.chaster_token.expires_in) < (new Date().getTime() / 1000)
}

async function getLocks(session) {
  const locks = await axios.get("https://api.chaster.app/locks", {
    headers: {
      Authorization: `Bearer ${session.chaster_token.access_token}`,
      accept: "application/json",
    },
  });
  session.chaster_locks = locks.data;
  console.log(session.chaster_locks);
}

async function getToken(session, code) {
  try {
    let data = {
      client_secret: process.env.CHASTER_CLIENT_SECRET,
      client_id: process.env.CHASTER_CLIENT_ID,
    };
    if (code !== undefined) {
      data.grant_type = "authorization_code";
      data.code = code;
      data.redirect_uri = `https://${process.env.PROJECT_DOMAIN}.glitch.me/chaster_callback`;
    } else {
      data.grant_type = "refresh_token";
      data.refresh_token = session.chaster_token.refresh_token;
    }
    const ttime = new Date().getTime() / 1000;
    const token = await axios.post(
      "https://sso.chaster.app/auth/realms/app/protocol/openid-connect/token",
      qs.stringify(data),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );
    session.chaster_token = token.data;
    session.chaster_token.ttime = ttime;
    console.log(session.chaster_token);
  } catch (e) {
    console.log(e);
    throw e;
  }
}

app.get("/", (req, res) => {
  res.render("main", {
    title: "Hey",
    message: "Hello there!",
    chaster_login: (req.session.chaster_token || "").length != 0,
  });
});

app.post("/connect_chaster", (req, res, next) => {
  console.log("post", req.body, req.query);
  var scopes = [];

  Object.keys(req.body).map(function (key, index) {
    if (req.body[key] == "on") {
      scopes.push(key);
    }
  });

  res.redirect(
    `https://sso.chaster.app/auth/realms/app/protocol/openid-connect/auth?client_id=${
      process.env.CHASTER_CLIENT_ID
    }&response_type=code&redirect_uri=${encodeURI(
      `https://${process.env.PROJECT_DOMAIN}.glitch.me/chaster_callback`
    )}&scope=locks`
  );
});

app.get("/chaster_callback", async (req, res, next) => {
  console.log("/chaster_callback", req.body, req.query, req.params);

  try {
    await getToken(req.session, req.query.code);
    console.log(req.session.chaster_token);
    await getLocks(req.session);
  } catch (e) {
    console.log("eer", e);
  }
  res.redirect("/");
});

// express-ws
app.ws("/connect_chaturbate", async (ws, req) => {
  console.log(req);

  let connected = true;
  let url = req.query.eventToken;

  ws.on("message", function (msg) {
    console.log("onmessage", msg);
    ws.send(msg);
  });

  ws.pingInterval = setInterval(() => ws.ping(), 1000 * 30);
  ws.on("close", function (msg) {
    connected = false;
    ws.pingInterval = null;
    console.log("connection closed");
  });

  try {
    await getLocks(req.session);
    ws.send(
      JSON.stringify(
        req.session.chaster_locks.map((l) => {
          return {
            lockId: l["_id"],
            endDate: l["endDate"],
            status: l["status"],
            totalDuration: l["totalDuration"],
          };
        })
      )
    );
  } catch (e) {
    ws.send(JSON.stringify(e));
    console.log("eer", e);
  }

  try {
    while (connected) {
      try {
        const events = await axios.get(url);
        url = events.data.nextUrl;
        console.log(`Got ${(events.data.events || []).length} events!`);
        if (connected && (events.data.events || []).length > 0) {
          console.log(events.data.events);
          events.data.events.forEach(async (e) => {
            ws.send(JSON.stringify(e));
            if ((e.method || "") == "tip") {
              const duration = getDuration(e.object.tip.tokens);
              if (
                duration > 0 &&
                (req.session.chaster_locks || []).length > 0
              ) {
                try {
                  if (needTokenRefresh(req.session)) {
                    await getToken(req.session);
                  }

                  let count = req.session.chaster_locks.length;
                  req.session.chaster_locks.forEach(async (l) => {
                    try {
                      await axios.post(
                        `https://api.chaster.app/locks/${l["_id"]}/update-time`,
                        { duration },
                        {
                          headers: {
                            Authorization: `Bearer ${req.session.chaster_token.access_token}`,
                            accept: "application/json",
                            "Content-Type": "application/json",
                          },
                        }
                      );
                      ws.send(
                        JSON.stringify({ lockId: l["_id"], delta: duration })
                      );
                      count--;
                    } catch (e) {
                      console.log("eer", e);
                      ws.send(JSON.stringify(e));
                      count--;
                    }
                  });
                  while (count > 0) {
                    await new Promise((r) => setTimeout(r, 50));
                  }
                  await getLocks(req.session);
                  ws.send(
                    JSON.stringify(
                      req.session.chaster_locks.map((l) => {
                        return {
                          lockId: l["_id"],
                          endDate: l["endDate"],
                          status: l["status"],
                          totalDuration: l["totalDuration"],
                        };
                      })
                    )
                  );
                } catch (e) {
                  ws.send(JSON.stringify(e));
                  console.log("eer", e);
                }
              }
            }
          });
        }
      } catch (e) {
        if (e.response && e.response.status >= 500 && e.response.status < 600) {
          continue;
        }
        throw e;
      }
    }
  } catch (e) {
    ws.send(JSON.stringify(e));
    console.log("eer", e);
  }
  ws.close();
});

// listen for requests :)
const listener = app.listen(process.env.PORT, () => {
  console.log(`Your app is listening on port ${listener.address().port}`);
});
