var ws = null
var logpane = null

function toggleForm(formId, enabled) {
  var form = document.getElementById(formId);
  var elements = form.elements;
  for (var i = 0, len = elements.length; i < len; ++i) {
    elements[i].readOnly = !enabled;
    elements[i].disabled = !enabled;
  }
}

function pollChaturbate() {
  
  const et = document.getElementById('eventToken').value

  if( logpane == null )
  {
    logpane = document.createElement('textarea');
    document.getElementById('log').append(logpane)
  }
  
  ws = new WebSocket("wss://" + window.location.hostname + "/connect_chaturbate?eventToken=" + encodeURI(et));
  ws.onopen = (event) => {
    toggleForm('chaturbateForm', false);
    console.log("onopen", event);
    logpane.value += "\nonopen:\n" + JSON.stringify(event)
  }
  ws.onmessage = (event) => {
    console.log("onmesage", event.data);
    logpane.value += "\nonmessage:\n" + event.data
  };
  ws.onerror = (event) => {
    toggleForm('chaturbateForm', true);
    console.log("onerror", event);
    logpane.value += "\nonerror:\n" + JSON.stringify(event)
  }
  ws.onclose = (event) => {
    toggleForm('chaturbateForm', true);
    console.log("onclose", event);
    logpane.value += "\nonclose:\n" + JSON.stringify(event)
  }

  return false;
}
