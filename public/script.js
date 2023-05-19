var ws = null

function pollChaturbate(eventToken){
  
  const et = eventToken || "https://events.testbed.cb.dev/events/blackspherefollower/53BzrVGLX0qbfso1jE0eJ4qQ/"
  
  
  ws = new WebSocket("wss://" + window.location.hostname + "/connect_chaturbate?eventToken=" + encodeURI(et));
  ws.onmessage = (event) => {
    console.log(event.data);
  };
  
  
    return false;
}
