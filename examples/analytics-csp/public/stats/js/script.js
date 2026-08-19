// A stand-in for the proxied Plausible tag. It reads its configuration from
// the data attributes the integration emits, exactly as the vendor script
// does. It then posts one pageview to the declared API path.
(function sendPageview() {
  var element = document.currentScript;
  var api = element.getAttribute("data-api");
  var domain = element.getAttribute("data-domain");

  fetch(api, {
    body: JSON.stringify({ d: domain, n: "pageview", u: window.location.href }),
    headers: { "content-type": "text/plain" },
    method: "POST",
  }).then(function markLoaded(reply) {
    var marker = document.createElement("div");
    marker.dataset.testid = "pageview-marker";
    marker.dataset.status = String(reply.status);
    document.body.appendChild(marker);
  });
})();
