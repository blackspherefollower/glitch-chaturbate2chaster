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
  const data = {
    grant_type: "authorization_code",
    code: req.query.code,
    client_secret: process.env.CHASTER_CLIENT_SECRET,
    client_id: process.env.CHASTER_CLIENT_ID,
    redirect_uri: `https://${process.env.PROJECT_DOMAIN}.glitch.me/chaster_callback`,
  };

  try {
    const token = await axios.post(
      "https://sso.chaster.app/auth/realms/app/protocol/openid-connect/token",
      qs.stringify(data),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );
    req.session.chaster_token = token.data;
    console.log(req.session.chaster_token);

    const locks = await axios.get("https://api.chaster.app/locks", {
      headers: {
        Authorization: `Bearer ${req.session.chaster_token.access_token}`,
        accept: "application/json",
      },
    });
    req.session.chaster_locks = locks.data;
    console.log(req.session.chaster_locks);
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
    const locks = await axios.get("https://api.chaster.app/locks", {
      headers: {
        Authorization: `Bearer ${req.session.chaster_token.access_token}`,
        accept: "application/json",
      },
    });
    req.session.chaster_locks = locks.data;
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
      const events = await axios.get(url);
      url = events.data.nextUrl;
      console.log(`Got ${(events.data.events || []).length} events!`);
      if (connected && (events.data.events || []).length > 0) {
        console.log(events.data.events);
        events.data.events.forEach(async (e) => {
          ws.send(JSON.stringify(e));
          if ((e.method || "") == "tip") {
            const duration = getDuration(e.object.tip.tokens);
            if (duration > 0 && (req.session.chaster_locks || []).length > 0) {
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
              try {
                const locks = await axios.get("https://api.chaster.app/locks", {
                  headers: {
                    Authorization: `Bearer ${req.session.chaster_token.access_token}`,
                    accept: "application/json",
                  },
                });
                req.session.chaster_locks = locks.data;
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
