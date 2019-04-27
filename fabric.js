
const yaml = require('js-yaml')
const fs = require('fs')
const path = require('path')
const config = require('./config.json')
const cmd = require('child_process');
const async = require('async')


const dir = './fabric_data'
const out_dir = './'
const domain = config.domain
const channelname = config.channelName
const image_tag = config.imageTag
const network = config.network

// conftx.yaml
function configtx() {
    let data = yaml.load(fs.readFileSync(path.join(__dirname, dir, 'configtx_template.yaml')))
    console.log(data)
    let j = 1;
    for (let key in config.orgs) {
        let org_obj = {
            Name: key + 'MSP',
            ID: key + 'MSP',
            MSPDir: 'crypto-config/peerOrganizations/' + key.toLowerCase() + '.' + domain + '/msp',
            Policies: {
                Readers: {
                    Type: 'Signature',
                    Rule: 'OR(\'' + key + 'MSP.admin\', \'' + key + 'MSP.peer\', \'' + key + 'MSP.client\')'
                },
                Writers: {
                    Type: 'Signature',
                    Rule: 'OR(\'' + key + 'MSP.admin\', \'' + key + 'MSP.client\')'
                },
                Admins: { Type: 'Signature', Rule: 'OR(\'' + key + 'MSP.admin\')' }
            },
            AnchorPeers: [
                {
                    Host: config.orgs[key][0],
                    Port: 7051
                }
            ]
        }
        data.Organizations[j] = org_obj
        data.Profiles.TwoOrgsChannel.Application.Organizations[j - 1] = org_obj
        data.Profiles.TwoOrgsOrdererGenesis.Consortiums.SampleConsortium.Organizations[j - 1] = org_obj
        j++
    }
    fs.writeFileSync(path.join(__dirname, out_dir, 'configtx.yaml'), yaml.safeDump(data, { lineWidth: 100 }))
}

//crypto-config.yaml
function crypto_config() {
    let data = yaml.load(fs.readFileSync(path.join(__dirname, dir, 'crypto-config_template.yaml')))
    console.log(data)
    let j = 0
    for (let key in config.orgs) {
        let org_obj = {
            Name: key,
            Domain: key.toLowerCase() + '.' + domain,
            EnableNodeOUs: true,
            Template: {
                Count: config.orgs[key].length
            },
            Users: {
                Count: 1
            }
        }
        data.PeerOrgs[j] = org_obj
        j++
    }
    console.log(data)
    fs.writeFileSync(path.join(__dirname, out_dir, 'crypto-config.yaml'), yaml.safeDump(data, { lineWidth: 100 }))
}

function generateCerts() {
    var ls = cmd.exec(path.join(__dirname, dir, 'cryptogen') + ' generate --config=' + path.join(__dirname, out_dir, 'crypto-config.yaml'), (err, stdout, stderr) => {
        if (err) console.log(err)
        console.log(stdout, stderr)
    })
}

function generateArtifacts() {
    cmd.exec(path.join(__dirname, out_dir, 'configtxgen') + ' -profile TwoOrgsChannel -outputCreateChannelTx ' + path.join(__dirname, out_dir, 'channel-artifacts/channel.tx') + '  -channelID ' + channelname, (err, stdout, stderr) => {
        if (err) console.log(err)
        console.log(stdout, stderr)
    })
    cmd.exec(path.join(__dirname, out_dir, 'configtxgen') + ' -profile TwoOrgsOrdererGenesis -outputBlock ' + path.join(__dirname, out_dir, 'channel-artifacts/genesis.block') + '  -channelID ' + channelname, (err, stdout, stderr) => {
        if (err) console.log(err)
        console.log(stdout, stderr)
    })
    for (let key in config.orgs) {
        cmd.exec(path.join(__dirname, out_dir, 'configtxgen') + ' -profile TwoOrgsChannel -outputAnchorPeersUpdate ' + path.join(__dirname, out_dir, 'channel-artifacts/' + key + 'MSPanchors.tx') + ' -channelID ' + channelname + ' -asOrg ' + key + 'MSP', (err, stdout, stderr) => {
            if (err) console.log(err)
            console.log(stdout, stderr)
        })
    }
}

function createBaseFiles() {
    let data = yaml.safeLoad(fs.readFileSync(path.join(__dirname, dir, 'base/docker-compose-base.yaml')))
    //orderer
    data.services['orderer.example.com'].image = 'hyperledger/fabric-orderer:' + image_tag
    let ports = [6051, 6053]
    // for peers
    for (let key in config.orgs) {

        for (let j in config.orgs[key]) {
            ports[0] += 1000
            ports[1] += 1000
            data.services[config.orgs[key][j]] = {
                container_name: config.orgs[key][j],
                extends: {
                    file: 'peer-base.yaml',
                    service: 'peer-base'
                },
                environment: ['CORE_PEER_ID=' + config.orgs[key][j],
                'CORE_PEER_ADDRESS=' + config.orgs[key][j] + ':7051',
                'CORE_PEER_GOSSIP_EXTERNALENDPOINT=' + config.orgs[key][j] + ':7051',
                'CORE_PEER_LOCALMSPID=' + key + 'MSP'],
                volumes: ['/var/run/:/host/var/run/',
                    '../crypto-config/peerOrganizations/' + key.toLowerCase() + '.' + domain + '/peers/' + config.orgs[key][j] + '/msp:/etc/hyperledger/fabric/msp',
                    '../crypto-config/peerOrganizations/' + key.toLowerCase() + '.' + domain + '/peers/' + config.orgs[key][j] + '/tls:/etc/hyperledger/fabric/tls',
                    config.orgs[key][j] + ':/var/hyperledger/production'],
                ports: [
                    ports[0] + ':7051',
                    ports[1] + ':7053'
                ]
            }
        }
    }
    delete data.services['peer0.template.example.com']
    fs.writeFileSync(path.join(__dirname, out_dir, 'base/docker-compose-base.yaml'), yaml.safeDump(data, { lineWidth: 200 }))
    // peer base
    let peer_base_data = yaml.safeLoad(fs.readFileSync(path.join(__dirname, dir, 'base/peer-base.yaml')))
    peer_base_data.services['peer-base'].image = 'hyperledger/fabric-peer:' + image_tag
    peer_base_data.services['peer-base'].environment.push('CORE_VM_DOCKER_HOSTCONFIG_NETWORKMODE=' + __dirname + '_byfn')

    fs.writeFileSync(path.join(__dirname, out_dir, 'base/peer-base.yaml'), yaml.safeDump(peer_base_data, { lineWidth: 200 }))
}

function createDockerFiles() {
    let data = yaml.safeLoad(fs.readFileSync(path.join(__dirname, dir, 'docker-compose-e2e-template.yaml')))
    data.networks[network] = null
    let i = 0;
    let port = 7054
    for (let key in config.orgs) {
        //ca service
        let priv_keys = fs.readdirSync(path.join(__dirname, out_dir, 'crypto-config/peerOrganizations', key.toLowerCase() + '.' + domain, 'ca'))
        let priv_key
        for (let t in priv_keys)
            if (priv_keys[t].indexOf('_sk') >= 0) priv_key = priv_keys[t]
        data.services['ca' + i] = {
            image: 'hyperledger/fabric-ca:latest',
            environment: ['FABRIC_CA_HOME=/etc/hyperledger/fabric-ca-server',
                'FABRIC_CA_SERVER_CA_NAME=ca-' + key.toLowerCase(),
                'FABRIC_CA_SERVER_TLS_ENABLED=true',
                'FABRIC_CA_SERVER_TLS_CERTFILE=/etc/hyperledger/fabric-ca-server-config/ca.' + key.toLowerCase() + '.' + domain + '-cert.pem',
                'FABRIC_CA_SERVER_TLS_KEYFILE=/etc/hyperledger/fabric-ca-server-config/' + priv_key],
            ports: [port + ':7054'],
            command: 'sh -c \'fabric-ca-server start --ca.certfile /etc/hyperledger/fabric-ca-server-config/ca.' + key.toLowerCase() + '.' + domain + '-cert.pem --ca.keyfile /etc/hyperledger/fabric-ca-server-config/' + priv_key + ' -b admin:adminpw -d\'',
            volumes: ['./crypto-config/peerOrganizations/' + key.toLowerCase() + '.' + domain + '/ca/:/etc/hyperledger/fabric-ca-server-config'],
            container_name: 'ca_peer' + key,
            networks: [network]
        }
        i++
        port = port + 1000
        for (let j in config.orgs[key]) {
            data.volumes[config.orgs[key][j]] = null
            data.services[config.orgs[key][j]] = {
                container_name: config.orgs[key][j],
                extends: {
                    file: 'base/docker-compose-base.yaml',
                    service: config.orgs[key][j]
                },
                networks: [network]
            }
        }
    }
    delete data.volumes['peer0.template.example.com']
    delete data.services['peer0.template.example.com']
    fs.writeFileSync(path.join(__dirname, out_dir, 'docker-compose.yaml'), yaml.safeDump(data, { lineWidth: 200 }))
}

function nodeFiles() {
    let data = yaml.safeLoad(fs.readFileSync(path.join(__dirname, dir, 'network-config.template.yaml')))
    console.log(data.certificateAuthorities['ca-packagerBosch'])
    // channel
    data.channels[channelname] = {
        orderers: ['orderer.example.com']
    }
    data.channels[channelname].peers = {}
    data.certificateAuthorities = {}
    for (let key in config.orgs) {
        for (let j in config.orgs[key]) {
            data.channels[channelname].peers[config.orgs[key][j]] = {
                endorsingPeer: true,
                chaincodeQuery: true,
                ledgerQuery: true,
                eventSource: true
            }
            //peers
            data.peers[config.orgs[key][j]] = {
                url: 'grpcs://localhost:7051',
                grpcOptions: {
                    'ssl-target-name-override': config.orgs[key][j]
                },
                tlsCACerts: {
                    path: 'artifacts/crypto-config/peerOrganizations/' + key.toLowerCase() + '.' + domain + '/peers/' + config.orgs[key][j] + '/tls/ca.crt'
                }
            }
            // ca 
            
            data.certificateAuthorities['ca-' + key.toLowerCase()] = {
                url: 'https://localhost:7054',
                httpOptions: { verify: false },
                tlsCACerts: { path: 'artifacts/crypto-config/peerOrganizations/' + key.toLowerCase() + '.' + domain + '/ca/ca.' + key.toLowerCase() + '.' + domain + '-cert.pem' },
                registrar: [{ enrollId: 'admin', enrollSecret: 'adminpw' }],
                caName: 'ca-' + key.toLowerCase()
            }
        }
        //organizations
        data.organizations[key] = {
            mspid: key + 'MSP',
            peers: config.orgs[key],
            certificateAuthorities: ['ca-' + key.toLowerCase()],
            adminPrivateKey: { path: 'artifacts/crypto-config/peerOrganizations/' + key.toLowerCase() + '.' + domain + '/users/Admin@' + key.toLowerCase() + '.' + domain + '/msp/keystore/privkey' },
            signedCert: { path: 'artifacts/crypto-config/peerOrganizations/' + key.toLowerCase() + '.' + domain + '/users/Admin@' + key.toLowerCase() + '.' + domain + '/msp/signcerts/Admin@' + key.toLowerCase() + '.' + domain + '-cert.pem' }
        }
    }
    fs.writeFileSync(path.join(__dirname, out_dir, 'network-config.yaml'), yaml.safeDump(data, { lineWidth: 200 }))
}

function exec_script(script_name){
    cmd.exec(script_name,(err,stdout,stderr)=>{
        if(err) console.log(err)
        console.log(stdout,stderr)
        return
    })
}
// nodeFiles()

async.waterfall([
    (cb) => {
        exec_script('./create_dir.sh')
        cb()
    },
    (cb) => {
        crypto_config()
        cb()
    }
    ,
    (cb) => {
        configtx()
        cb()
    },
    (cb) => {
        generateCerts()
        cb()
    },
    (cb) => {
        setTimeout(() => {
            generateArtifacts()
            cb()
        }, 1000)
    },
    (cb) => {
        createBaseFiles()
        cb()
    },
    (cb) => {
        createDockerFiles()
        cb()
    }
], (err) => {
    if (err) {
        console.log(err)
    }
})

