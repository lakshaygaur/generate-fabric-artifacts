mkdir network_files
mv base network_files/

if [ ! -d network_files/channel-artifacts ]; then
    mkdir network_files/channel-artifacts
fi
mv channel-artifacts network_files/

mv crypto-config network_files/
mv crypto-config.yaml network_files/
mv configtx.yaml network_files/
mv docker-compose.yaml network_files/
mv network-config.yaml network_files/