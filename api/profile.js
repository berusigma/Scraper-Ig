export default async function handler(req, res) {
    // Setting CORS biar aman ditarik sama aplikasi Kotlin lu
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');

    const { url } = req.query;

    if (!url) {
        return res.status(400).json({ success: false, message: "Link Instagram-nya mana bro?" });
    }

    try {
        let username = "";

        // 1. LOGIKA PEMBERSIH LINK
        if (url.includes("instagram.com")) {
            const parsedUrl = new URL(url);
            username = parsedUrl.pathname.replace(/\//g, '').trim(); 
        } else {
            username = url.replace('@', '').trim();
        }

        if (!username) {
            throw new Error("Gagal nemuin username dari link tersebut.");
        }

        // 2. MESIN PENYEDOT UTAMA (Tembak API Internal IG tanpa Cookie)
        const targetUrl = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}`;

        const response = await fetch(targetUrl, {
            method: 'GET',
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
                "X-IG-App-ID": "936619743392459",
                "Accept-Language": "en-US,en;q=0.9",
                "Sec-Fetch-Mode": "cors",
                "Sec-Fetch-Site": "same-origin"
            }
        });

        if (!response.ok) {
            throw new Error(`IG nolak akses (Status: ${response.status}) - Coba refresh atau deploy ulang.`);
        }

        const data = await response.json();
        
        if (!data || !data.data || !data.data.user) {
            throw new Error("Akun gak ketemu atau di-private 100%");
        }

        const user = data.data.user;

        // ==========================================
        // 3. MESIN PEMBONGKAR POSTINGAN (GRID, REELS, CAROUSEL)
        // ==========================================
        const timelineEdges = user.edge_owner_to_timeline_media.edges || [];
        const posts_data = timelineEdges.map(edge => {
            const node = edge.node;
            let children = [];

            // Kalau postingannya berupa kumpulan foto/video (Slide)
            if (node.__typename === 'GraphSidecar' && node.edge_sidecar_to_children) {
                children = node.edge_sidecar_to_children.edges.map(child => {
                    const cNode = child.node;
                    return {
                        id: cNode.id,
                        type: cNode.__typename, // GraphImage atau GraphVideo
                        url: cNode.is_video ? cNode.video_url : cNode.display_url
                    };
                });
            }

            return {
                id: node.id,
                shortcode: node.shortcode,
                type: node.__typename, // Jenis: GraphImage, GraphVideo, atau GraphSidecar
                thumbnail: node.display_url,
                video_url: node.video_url || null, // Bakal keisi kalau dia Reels
                carousel_items: children // Bakal keisi kalau dia foto Slide
            };
        });

        // ==========================================
        // 4. SUSUN DATA BIAR RAPI UNTUK KOTLIN
        // ==========================================
        res.status(200).json({
            success: true,
            extracted_username: username, 
            profile: {
                id: user.id,
                full_name: user.full_name,
                bio: user.biography,
                profile_pic_hd: user.profile_pic_url_hd, 
                followers: user.edge_followed_by.count,
                following: user.edge_follow.count,
                total_posts: user.edge_owner_to_timeline_media.count,
                is_private: user.is_private
            },
            data: {
                posts: posts_data
            }
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Mesin gagal nyedot data",
            error: error.message
        });
    }
}
