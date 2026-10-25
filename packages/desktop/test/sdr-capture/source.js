/* global document, setInterval */
// Keep the controlled window changing so WGC produces frames after configure.
setInterval(() => document.getElementById('pulse').classList.toggle('alternate'), 50);
