# Generate fabric artifacts
How to use : 
* change/add orgnames and peers in *config.json*
* external module required - js-yaml ( ```npm install js-yaml```).
* to clear artifacts, run ```./clearData.sh```
* to generate artifacts and docker file, run ``` node fabric ```
* run `./move.sh` to move all artifacts files into one folder.

**Note**: Orderer configs are static and uses example.com as domain.
