# NABP
NABP (Not a Buttplug) is a connector between [ScriptPlayer](https://github.com/FredTungsten/ScriptPlayer) and [OSR2](https://www.patreon.com/tempestvr).

It works by imitating a [Buttplug](https://buttplug.io/) server and sending TCode commands to the OSR2.

## Setup
1) You need a beta version of ScriptPlayer from AppVeyor, see https://github.com/FredTungsten/ScriptPlayer/wiki/Downloading-Beta-Builds
2) Next you need to have [Node.js](https://nodejs.org/en/) installed on your computer (tested on Node.js v14.16.1).
3) Connect your OSR2 to the computer.
4) Launch the ScriptPlayer.
5) Download this repo to a folder and open terminal at the location.
6) Run `npm install` to download dependencies (you only have to do this once).
7) Finally, run `node main.js`, which will start NABP.

After starting NABP, you'll see list of available COM ports, pick the correct one for your OSR2. After it's selected, the server will start up.
Now just click "Devices -> Buttplug / Intiface -> Connect" in ScriptPlayer and you should be ready for action.