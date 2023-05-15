import { WebrtcService } from './../service/webrtc.service';
import { Component, OnInit } from '@angular/core';

@Component({
  selector: 'app-video',
  templateUrl: './video.component.html',
  styleUrls: ['./video.component.css']
})
export class VideoComponent implements OnInit 
{
    constructor(private _webRtcService : WebrtcService) { }

    ngOnInit(): void 
    {
        this._webRtcService.initRtcPeerConnection();
    }
}
