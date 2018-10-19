const Pool = require('../pool');
const EventEmitter = require('events');
const Routers = require('../../routers');
const ws = require('../../routers/ws');
const onion = require('../../routers/onion');
const p2p = require('../../routers/p2p');
const EC = require('elliptic').ec;
const ec = new EC('secp256k1');
const dgram = require('dgram');
const Peer = require('../peer');

const PORT = 49410;
const MCAST_ADDR = "230.185.192.108";
        
let easterEgg = false;
// special port is 9410 
class Node extends EventEmitter {
    constructor(name, { port = 9410, findLocalPeers = true }) {
        super();
        this.name = name;
        this.pool = new Pool(name);
        this.routers = new Routers(this);
        
        this.port = port;
        this.routers.use('ws', new ws({ node: this, port: port }));
        this.routers.use('onion', new onion({ node: this }));
        this.routers.use('p2p', new p2p({ node: this }));
        
        this.nonces = {};
        this.peers = [];

        this.routerKey = ec.genKeyPair();
        this.shouldBroadcastLAN = findLocalPeers;
    }
    
    async listen() {
        let vals = Object.values(this.routers.routers);
        for(let i = 0; i < vals.length; i++) {
            await vals[i].listen(); 
        }
        
        if(this.shouldBroadcastLAN)
            this.findLocalPeers();

        let socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
        this.emit('ready');
    }

    findLocalPeers() {
        let socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
        socket.bind(PORT, () => {
            socket.setBroadcast(true);
            socket.setMulticastTTL(128);
            socket.addMembership(MCAST_ADDR);
        });
        
        socket.on('message', async (message, remote) => {  
            let payload = JSON.parse(message);
            let address =  `ws/${remote.address}:${payload.port}`;
            await this.addPeer(new Peer({ node: this, address: address, publicKey: Buffer.from(payload.publicKey, 'hex') }));
            console.log('\x1b[36mMCast received by ' + address, '\x1b[0m'); 
        });

        var message = Buffer.from(JSON.stringify({
            port: this.port,
            publicKey: this.routerKey.getPublic('hex')
        }));
        socket.send(message, 0, message.length, PORT, MCAST_ADDR);
        console.log('\x1b[36mPresence brodcasted to LAN', '\x1b[0m')
    }
    
    async addPeer(peer, initialize = true) {
        if(peer.publicKey.toString('hex') == this.routerKey.getPublic('hex'))
            return;
        
        console.log("added " + peer.address);
        this.peers.push(peer);

        if(!initialize) return;
        let newPeers = await peer.requestPeers();
        newPeers.forEach(newPeer => {
            if(!this.peers.any(x => x.address == newPeer.address)) {
                this.addPeer(new Peer({ node: this, address: newPeer.address, publicKey: Buffer.from(newPeer.publicKey, 'hex') }), false);
            }
        });
    }

    receive(msg) {
        console.log(msg.body.__packet__);
        switch(msg.body.__packet__) {
            case 'get_peers':
                console.log("responding w/ peer list");
                msg.end(peers.map(x => {
                    return {
                        address: x.address,
                        publicKey: x.publicKey
                    };
                }));
                break;
            default:
                this.emit('message', msg);
        }
    }

    easter(name) {
        easterEgg = true;
        console.log(`Nice job, ${name}!`);
    }
}
module.exports = Node;