import React, { useEffect, useRef, useState } from "react";

const SIGNALING_SERVER_URL = "wss://2c6791b11099.ngrok-free.app/signaling";
const ROOM_NAME = "testroom";

export default function MultiPartyCall() {
  const localVideoRef = useRef(null);
  const [peers, setPeers] = useState({});
  const ws = useRef(null);
  const localStream = useRef(null);
  const [peerStreams, setPeerStreams] = useState({});

  const isWsOpenRef = useRef(false);
  const [isWsOpen, setIsWsOpen] = useState(false);

  useEffect(() => {
    let wsConnection;

    navigator.mediaDevices
      .getUserMedia({ video: true, audio: true })
      .then((stream) => {
        localStream.current = stream;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }

        wsConnection = new WebSocket(SIGNALING_SERVER_URL);
        ws.current = wsConnection;

        wsConnection.onopen = () => {
          console.log("WebSocket connected");
          setIsWsOpen(true);
          isWsOpenRef.current = true;
        };

        wsConnection.onmessage = async (message) => {
          const data = JSON.parse(message.data);

          if (data.type === "id") {
            ws.current.id = data.id;
            console.log("Assigned ID:", data.id);
            wsConnection.send(JSON.stringify({ type: "join", room: ROOM_NAME }));

          } else if (data.type === "peers") {
            if (isWsOpenRef.current) {
              await handlePeersUpdate(data.peers);
            }

          } else if (data.type === "offer") {
            await handleOffer(data);

          } else if (data.type === "answer") {
            await handleAnswer(data);

          } else if (data.type === "ice-candidate") {
            await handleIceCandidate(data);
          }
        };

        wsConnection.onclose = () => {
          console.log("WebSocket closed");
          setIsWsOpen(false);
          isWsOpenRef.current = false;
        };
      })
      .catch((e) => console.error("getUserMedia error", e));

    return () => {
      Object.values(peers).forEach(({ pc }) => pc.close());
      if (localStream.current) {
        localStream.current.getTracks().forEach((t) => t.stop());
      }
      if (ws.current) ws.current.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePeersUpdate = async (peerIds) => {
    if (!localStream.current || !isWsOpenRef.current) return;
    const myId = ws.current.id;

    for (const peerId of peerIds) {
      if (peerId === myId) continue; // skip self
      if (!peers[peerId]) {
        await createPeerConnection(peerId, true);
      }
    }

    for (const existingPeerId of Object.keys(peers)) {
      if (!peerIds.includes(existingPeerId)) {
        peers[existingPeerId].pc.close();
        const newPeers = { ...peers };
        delete newPeers[existingPeerId];
        setPeers(newPeers);

        const newStreams = { ...peerStreams };
        delete newStreams[existingPeerId];
        setPeerStreams(newStreams);
      }
    }
  };

  const createPeerConnection = async (peerId, isOfferer) => {
    if (!localStream.current || !isWsOpenRef.current) return;

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    localStream.current.getTracks().forEach((track) => {
      pc.addTrack(track, localStream.current);
    });

    pc.ontrack = (event) => {
      setPeerStreams((prev) => ({ ...prev, [peerId]: event.streams[0] }));
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        ws.current.send(
          JSON.stringify({
            type: "ice-candidate",
            to: peerId,
            from: ws.current.id,
            data: event.candidate,
          })
        );
      }
    };

    if (isOfferer) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      ws.current.send(
        JSON.stringify({
          type: "offer",
          to: peerId,
          from: ws.current.id,
          data: offer,
        })
      );
    }

    setPeers((prev) => ({ ...prev, [peerId]: { pc } }));
  };

  const handleOffer = async ({ from, data }) => {
    await createPeerConnection(from, false);
    const pc = peers[from]?.pc;
    if (!pc) return;

    await pc.setRemoteDescription(new RTCSessionDescription(data));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    ws.current.send(
      JSON.stringify({
        type: "answer",
        to: from,
        from: ws.current.id,
        data: answer,
      })
    );
  };

  const handleAnswer = async ({ from, data }) => {
    const pc = peers[from]?.pc;
    if (!pc) return;
    await pc.setRemoteDescription(new RTCSessionDescription(data));
  };

  const handleIceCandidate = async ({ from, data }) => {
    const pc = peers[from]?.pc;
    if (!pc) return;
    try {
      await pc.addIceCandidate(new RTCIceCandidate(data));
    } catch (e) {
      console.error("Error adding received ice candidate", e);
    }
  };

  return (
    <div>
      <h2>Multi-Party Video Call (React + WebRTC)</h2>
      <div>
        <h3>Local Video</h3>
        <video
          ref={localVideoRef}
          autoPlay
          muted
          playsInline
          style={{ width: "300px", border: "1px solid black" }}
        />
      </div>
      <div>
        <h3>Remote Videos</h3>
        {Object.entries(peerStreams).map(([peerId, stream]) => (
          <video
            key={peerId}
            autoPlay
            playsInline
            ref={(video) => {
              if (video && video.srcObject !== stream) {
                video.srcObject = stream;
              }
            }}
            style={{ width: "300px", border: "1px solid black", margin: "5px" }}
          />
        ))}
      </div>
    </div>
  );
}
