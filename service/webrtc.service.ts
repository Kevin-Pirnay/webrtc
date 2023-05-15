import { Injectable } from '@angular/core';
import * as signalR from '@microsoft/signalr';
import { HubConnection } from '@microsoft/signalr';


@Injectable({
  providedIn: 'root'
})
export class WebrtcService 
{
    constructor(private _hubConnector : HubConnector, private _caller : Caller, private _recipient : Recipient) { }

    private initConnectionWithSignalingServer = async () =>
    {
        await this._hubConnector.initConnection();
    }

    private initEventWebRtc = async () : Promise<void> =>
    {   
        this._hubConnector.on("other user",(userId :string)=> this._caller.callUser(userId));
        this._hubConnector.on("offer",this._recipient.receiveOffer);
        this._hubConnector.on("ice-candidate",this._caller.handleIceCandidateMsg);
    }

    public initRtcPeerConnection = async () : Promise<void> =>
    {
        await this.initConnectionWithSignalingServer();
        this.initEventWebRtc();
    }

}

export class RtcPeerUser
{
    protected _peerConnection : RTCPeerConnection | null = null ;

    protected captureLocalMedia = async () : Promise<MediaStream> =>
    {
        const localStream = await navigator.mediaDevices.getUserMedia({video:true,audio:false});

        const user_1 = document.getElementById('user-1') as HTMLMediaElement;
        if(user_1) user_1.srcObject = localStream;

        return localStream;
    }

    protected includeTheLocalStreamIntoTheRtcPeerConnectionToBeSent = (localMediaStream : MediaStream, peerConnection : RTCPeerConnection) : void =>
    {
        localMediaStream.getTracks().forEach(track=> 
        {
            peerConnection.addTrack(track, localMediaStream);
        });
    }

    protected handleTrackEvent = (e : any) : void =>
    {      
        const user_2 = document.getElementById('user-2') as HTMLMediaElement;
        if(user_2) user_2.srcObject = e.streams[0];
        else throw new Error("no media element to get the stream or no remote stream");
    }
}

@Injectable({
    providedIn: 'root'
  })
export class Caller extends RtcPeerUser
{
    constructor(private _hubConnector : HubConnector) { super(); }

    public callUser = async(recipientConnectionId : string) : Promise<void> =>
    {        
        const localMediaStream = await this.captureLocalMedia(); 
        const peerConnection = this.createRtcPeerConnection(recipientConnectionId);
        this.includeTheLocalStreamIntoTheRtcPeerConnectionToBeSent(localMediaStream, peerConnection); 
    }

    private createRtcPeerConnection = (recipientConnectionId : string) : RTCPeerConnection =>
    {
        const peerConnection  = new RTCPeerConnection({ iceServers:[ { urls:['stun:stun1.l.google.com:19302','stun:stun2.l.google.com:19302'] } ] });

        peerConnection.onicecandidate = this.handleIceCandidateEvent;
        peerConnection.ontrack = this.handleTrackEvent;
        peerConnection.onnegotiationneeded = () => this.handleNegotiationNeeded(recipientConnectionId, peerConnection);

        this.savePeerConnectionAsAState(peerConnection);

        return peerConnection;
    }

    private createAnOfferAndSetAsALocalDescription = async (peerConnection : RTCPeerConnection) : Promise<RTCSessionDescriptionInit | undefined> =>
    {
        const offer = await peerConnection.createOffer();       
        await peerConnection.setLocalDescription(offer);
        return offer;
    }

    private sendOffer = (recipientConnectionId : string, offer : RTCSessionDescriptionInit ) : void =>
    {
        if(this._hubConnector.myConnectionId)
        {
            const payload : Payload = { target : recipientConnectionId, caller :  this._hubConnector.myConnectionId, sdp : offer }
            this._hubConnector.invoke("offer",payload);
        }
    }

    public handleIceCandidateMsg = (incoming : any) : void =>
    {
        const candidate = new RTCIceCandidate(incoming);
        
        this.getPeerConnectionSaved().addIceCandidate(candidate); 
    }

    private handleIceCandidateEvent = (e : any) : void =>
    {
        //trigger automatically when the caller set remote description
        if(e.candidate && this._hubConnector.otherUserPeerConnectionId)
        {
            const payload = {  target : this._hubConnector.otherUserPeerConnectionId, candidate : e.candidate };
            this._hubConnector.invoke("IceCandidate",payload);
        }
    }

    private handleNegotiationNeeded = async (recipientConnectionId : string, peerConnection : RTCPeerConnection) =>
    {        
        const offer = await this.createAnOfferAndSetAsALocalDescription(peerConnection);
        this.prepareToReceiveAnswerEvent(peerConnection);
        if (offer) this.sendOffer(recipientConnectionId,offer);
    }

    public receiveAnswer = (answer : Payload, peerConnection : RTCPeerConnection) : void =>
    {
        peerConnection.setRemoteDescription(answer.sdp);
    }

    private prepareToReceiveAnswerEvent = (peerConnection : RTCPeerConnection) : void =>
    {
        this._hubConnector.on("answer", (answer : Payload) => this.receiveAnswer(answer, peerConnection));
    }

    private savePeerConnectionAsAState = (peerConnection : RTCPeerConnection) : void =>
    {
        this._peerConnection = peerConnection;
    }

    private getPeerConnectionSaved = () : RTCPeerConnection =>
    {
        if (this._peerConnection !== null) return this._peerConnection;
        else throw new Error("no connection are currently saved into the state");
    }
}

@Injectable({
    providedIn: 'root'
  })
export class Recipient extends RtcPeerUser
{
    constructor(private _hubConnector : HubConnector) { super() }

    public receiveOffer = async(offer : Payload) : Promise<void> =>
    {
        const localMediaStream = await this.captureLocalMedia();
        const peerConnection = this.createRtcPeerConnection();
        this.includeTheLocalStreamIntoTheRtcPeerConnectionToBeSent(localMediaStream, peerConnection);
        await this.setTheRemoteDescription(offer.sdp, peerConnection);
        const answer = await this.createAnswerAndSetAsLocalDescription(peerConnection);
        if (answer) this.sendAnswer(offer,answer);
    }

    private createRtcPeerConnection = () : RTCPeerConnection =>
    {
        const peerConnection  = new RTCPeerConnection({ iceServers:[ { urls:['stun:stun1.l.google.com:19302','stun:stun2.l.google.com:19302'] } ] });
        peerConnection.onicecandidate = this.handleIceCandidateEvent;
        peerConnection.ontrack = this.handleTrackEvent;
        return peerConnection;
    }

    private setTheRemoteDescription = async (sdp : RTCSessionDescriptionInit, peerConnection : RTCPeerConnection) : Promise<void> =>
    {
        await peerConnection.setRemoteDescription(sdp);
    }

    private createAnswerAndSetAsLocalDescription = async (peerConnection : RTCPeerConnection) : Promise<RTCSessionDescriptionInit | undefined> =>
    {
        const answer = await peerConnection.createAnswer();
        peerConnection.setLocalDescription(answer);
        return answer;
    }

    private sendAnswer = (offer : Payload, answer : RTCSessionDescriptionInit) : void =>
    {
        const payload :Payload = { target : offer.caller, caller :  offer.target, sdp : answer }        
        this._hubConnector.invoke("answer", payload);
    }

    private handleIceCandidateEvent = (e : any) : void =>
    {
        if(e.candidate && this._hubConnector.otherUserPeerConnectionId)
        {
            const payload = {  target : this._hubConnector.otherUserPeerConnectionId, candidate : e.candidate };
            this._hubConnector.invoke("IceCandidate",payload);
        }
    }
}


@Injectable({
    providedIn: 'root'
  })
export class HubConnector
{
    private _connection : signalR.HubConnection | null = null;
    private _roomName : string = "myRoom";
    public myConnectionId : string | null = null;
    public otherUserPeerConnectionId : string | null = null;



    private createConnection = () : HubConnection =>
    {
        const connection = new signalR.HubConnectionBuilder()
            .withUrl("https://192.168.1.7:5000/signaling")
            .build();
        this.saveConnectionAsState(connection);
        return connection;
    }

    private saveConnectionAsState = (connection : HubConnection) : void =>
    {
        this._connection = connection;
    }

    private getTheConnectionSaved = () : HubConnection =>
    {
        if (this._connection !== null) return this._connection;
        else throw new Error("no connection is currently set");
    }

    public invoke = <T>(event : string, data : T) : void =>
    {
        this.getTheConnectionSaved().invoke(event,data);
    }

    public on = <T>(event : string, callback : (data : T)=> void) : void =>
    {
        this.getTheConnectionSaved().on(event,callback);
    }

    private startConnection = async (connection : HubConnection) : Promise<void> =>
    {
        await connection.start();
        connection.on("connection",(connectionId : string)=> this.myConnectionId = connectionId);
        connection.invoke("connection");
    }

    public initConnection = async () : Promise<void> =>
    {
        const connection = this.createConnection();
        await this.startConnection(connection);
        this.initEvent(connection);
        this.joinTheRoom();
    }

    private initEvent = (connection : HubConnection) : void =>
    {
        this.initOnConnectionEvent(connection);
        this.initUserJoinedEvent(connection);
    }

    private initOnConnectionEvent = (connection : HubConnection) : void =>
    {
        connection.on("connection",(connectionId : string)=> 
        {
            this.myConnectionId = connectionId;
            console.log("connectionId : ",connectionId);   
        });
    }

    private initUserJoinedEvent = (connection : HubConnection) : void =>
    {
        connection.on("userJoined",(connectionId : string)=> 
        {
            if(connectionId !== this.myConnectionId)
            {
                this.otherUserPeerConnectionId = connectionId;

                const data : OtherUserData = {connectionId:connectionId}
                connection.invoke("otherUser", data);
            }
        });
    }

    private joinTheRoom = () : void =>
    {        
        const data : JoinRoomData = { groupRoomId : this._roomName };

        this.invoke("JoinRoom", data);
    }
}

interface JoinRoomData
{
    groupRoomId : string;
}

interface OtherUserData
{
    connectionId : string
}

export interface Payload
{
    target : string;
    caller : string;
    sdp : RTCSessionDescriptionInit
}
